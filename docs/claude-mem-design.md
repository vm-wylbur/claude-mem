
# Design: Hooks integration, remote MCP over SSE, and progressive tool disclosure

**Status:** Proposal
**Context:** Multi-machine deployment across a self-hosted Tailscale network, central PostgreSQL/pgvector backend, Claude Code as primary client.
**Problem statement:** Three compounding issues currently limit production usefulness: (1) memory capture requires manual action and is routinely skipped; (2) each machine runs its own local MCP instance with no shared state except the DB connection; (3) tool schema verbosity consumes 60K+ tokens at session start, burning ~30% of usable context before any work begins.

---

## Problem 1: Automatic memory capture via Claude Code hooks

### Current state

Memory only enters the system when Claude or the user explicitly calls `store-dev-memory` or `quick-store`. In practice this happens rarely — sessions end, context gets compacted, and the work is lost. The cursor problem: both parties have to remember to remember.

### Proposed solution: Hook-driven ingestion

Claude Code's hooks system provides deterministic triggers that fire regardless of whether Claude or the user thinks to call them. Three hooks cover the ingestion lifecycle:

**`Stop` hook** — fires after each Claude turn completes. This is the primary capture point.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/mem-capture.sh",
          "timeout": 5
        }]
      }
    ]
  }
}
```

The hook receives session metadata on stdin (session_id, transcript_path, cwd). The script reads the most recent turn from the JSONL transcript, extracts `<remember>...</remember>` blocks if present, and POSTs to the MCP server's HTTP endpoint (see Problem 2). If no `<remember>` blocks exist, it extracts a lightweight summary (tool calls made, files modified, key outputs) and queues it for async write.

Fire-and-forget pattern — the script exits 0 immediately after queuing; a background worker handles the actual postgres write. This keeps the hook within the 5s timeout without blocking Claude's next turn.

**`PreCompact` hook** (matcher: `auto`) — fires before auto-compaction destroys session context. This is the safety net for long sessions.

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/mem-precompact.sh",
          "timeout": 10
        }]
      }
    ]
  }
}
```

This hook has a longer window and does a more thorough extraction: key decisions made, architectural choices, files created/modified with their purpose, any errors encountered and how they were resolved. This is higher-value than per-turn capture and worth the extra seconds since compaction already interrupts the session.

**`SessionStart` hook** (matcher: `startup`) — fires at session start, injects relevant memories as context.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/mem-inject.sh",
          "timeout": 8
        }]
      }
    ]
  }
}
```

The script queries the MCP server for recent context in the current project (using cwd from stdin to identify project), formats as a brief structured briefing, and writes to stdout. Claude Code injects this stdout content into the session context. Keeps the injected content under 2K tokens — summary only, with memory IDs the user can expand with `get-dev-memory <id>` if needed.

### The `<remember>` tag convention

Steal this pattern from KaimingWan/oh-my-claude (not the whole plugin, just this mechanism). Add to CLAUDE.md or the memory skill:

```
When you learn something worth preserving — a gotcha, a working pattern,
an architectural decision — output it as:
<remember>concise statement of what was learned</remember>

These are captured automatically. Do not call store-dev-memory manually
unless the memory requires rich metadata.
```

This makes capture intentional from Claude's side without requiring user action. The `Stop` hook scans for these tags preferentially; turns with no tags get lightweight auto-summary instead.

### Session degradation signals

The hooks system also enables automated detection of context degradation — a stated use case for the memory system. Add to the `PostToolUseFailure` hook:

```json
{
  "hooks": {
    "PostToolUseFailure": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/mem-degradation.sh"
        }]
      }
    ]
  }
}
```

Track: repeated tool failures in same session, same-file edits > 3 times, bash command retry loops. Log these as tagged memories (`tag: session-degradation`) with session_id. Over time this builds a corpus of degradation patterns useful for tuning compaction thresholds and session length guidelines.

### Hook deployment

Hooks configure at user scope (`~/.claude/settings.json`) so they apply to all projects without per-repo setup. Since all machines are on the Tailnet and can reach the central MCP server, the hook scripts are identical across machines — parameterized only by the MCP server URL, which comes from an env var or a shared config file.

Deploy via the existing dotfiles/config sync mechanism. The hook scripts themselves are small bash; commit them to this repo under `hooks/`.

---

## Problem 2: Remote MCP over SSE for multi-machine access

### Current state

Each machine runs `node dist/index.js` locally over stdio, all connecting to the same central PostgreSQL. This works but means each machine independently manages its MCP server process, and hooks on one machine can't call memory tools on another without a network endpoint.

### Proposed solution: SSE transport on the central server

Add SSE transport support to the existing server. The MCP TypeScript SDK supports this natively — it's a transport-layer change, not an architectural one.

**Server-side change** (`src/index.ts`):

```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();
const transports = new Map<string, SSEServerTransport>();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  transports.set(transport.sessionId, transport);

  const server = createMemoryServer(); // existing server factory
  await server.connect(transport);

  res.on('close', () => {
    transports.delete(transport.sessionId);
  });
});

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

app.listen(3456, '0.0.0.0'); // bind to Tailscale interface if preferred
```

Run this on the machine that hosts PostgreSQL (or any always-on machine on the Tailnet). One process, all machines connect to it.

**Client-side config** (on each machine, user scope):

```bash
claude mcp add --transport sse --scope user claude-mem-remote \
  http://db-host.tailnet:3456/sse
```

Or in `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-mem": {
      "type": "sse",
      "url": "http://db-host.tailnet:3456/sse"
    }
  }
}
```

Keep the stdio server available for local dev/testing. The SSE server is for production multi-machine use.

**Auth:** Tailscale handles network-layer auth — no additional auth needed if you trust your Tailnet. Optionally add a shared secret header if you want defense in depth:

```typescript
app.use((req, res, next) => {
  const secret = req.headers['x-claude-mem-secret'];
  if (secret !== process.env.CLAUDE_MEM_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});
```

**Deployment:** Run under systemd on the DB host. The existing `npm run build` workflow applies; just add a new npm script `start:sse` that launches the SSE variant.

**Why not Supergateway?** Supergateway wraps the stdio server in a separate process with an HTTP shim. This adds a process boundary, makes debugging harder, and means you're maintaining two things. Native SSE in the SDK is the right path — same codebase, same tools, just a different transport.

---

## Problem 3: Progressive tool disclosure to reduce token overhead

### Current state

The MCP server exposes all tools simultaneously at session start. With current tool count and schema verbosity, this costs 60K+ tokens before any work begins — roughly 30% of the usable context window on standard plans.

### Root cause

MCP tool schemas are injected into Claude's context by the client (Claude Code) when it enumerates the server's tools. Verbose `description` fields and detailed `inputSchema` definitions multiply quickly. 9 tools × ~6K tokens average schema = 54K tokens, plus any auto-injected context from `get-recent-context`.

### Proposed solution: Tiered tool exposure

Split the server's tools into two tiers exposed via two separate MCP servers (or server modes):

**Tier 1: Lightweight server** (always connected, minimal tokens)

Expose only three tools with minimal schema descriptions:

| Tool | Description (what goes in the schema) | Est. tokens |
|------|--------------------------------------|-------------|
| `mem-search` | Semantic search. Args: query (string), limit (int, default 5) | ~800 |
| `mem-recent` | Recent context for current project. Args: n (int, default 10) | ~600 |
| `mem-store` | Store a memory. Args: content (string), tags (string[]) | ~700 |

Total tier-1 cost: ~2,100 tokens. This is the 95% case — search before acting, store after learning, get recent context at session start.

**Tier 2: Full server** (connected on demand or for curation sessions)

All current tools with full schemas: `store-dev-memory` (rich metadata), `search-enhanced`, `get-dev-memory`, `list-dev-memories`, `memory-overview`, `get-all-tags`, `list-memories-by-tag`, relationship tools.

Connect tier-2 when doing explicit curation work, not during normal coding sessions:

```bash
# Normal coding session — tier 1 only (from ~/.claude.json permanent config)
claude-mem: http://db-host.tailnet:3456/sse/lite

# Curation session — add tier 2 for this session
claude mcp add --scope local claude-mem-full http://db-host.tailnet:3456/sse/full
```

**Implementation:** The SSE server from Problem 2 routes `/sse/lite` and `/sse/full` to different server instances sharing the same DB connection pool:

```typescript
app.get('/sse/lite', (req, res) => connectServer(createLiteServer(), req, res));
app.get('/sse/full', (req, res) => connectServer(createFullServer(), req, res));
app.get('/sse',      (req, res) => connectServer(createFullServer(), req, res)); // backward compat
```

`createLiteServer()` registers only the three tier-1 tools. `createFullServer()` registers everything. Same DB service underneath.

**Schema verbosity reduction:** Regardless of tiering, audit all tool `description` fields and `inputSchema` descriptions. The MCP spec doesn't require prose documentation in schemas — it requires correctness. Strip anything that reads like a README. Target: under 500 tokens per tool description including schema.

**Auto-injection budget:** The `SessionStart` hook (Problem 1) injects recent context. Cap this at 1,500 tokens hard. The hook script truncates to fit. Memory IDs in the injected content let Claude fetch full details on demand with `mem-search` or `mem-recent`.

### Token budget target

| Source | Current | Target |
|--------|---------|--------|
| Tier-1 tool schemas | 60K+ | ~2K |
| SessionStart injection | variable | ≤1.5K |
| **Total memory overhead** | **60K+** | **~3.5K** |

---

## Implementation sequence

These three problems are coupled but decomposable. Recommended order:

**Phase 1: SSE transport** — enables everything else. Without a network endpoint, hooks can't call memory tools from the client machines. Two days of work: add express + SSE transport, test across two machines, deploy under systemd.

**Phase 2: Progressive disclosure** — split into lite/full servers, audit schema verbosity, measure token reduction. Can be done in parallel with Phase 1 once the SSE routing is working. One day of work.

**Phase 3: Hooks** — write the three hook scripts (`mem-capture.sh`, `mem-precompact.sh`, `mem-inject.sh`), add `<remember>` convention to CLAUDE.md/skill, test fire-and-forget async pattern. Deploy to all machines via dotfiles sync. Two to three days including tuning.

**Phase 4: Degradation tracking** — add `PostToolUseFailure` hook, tag schema for degradation signals, basic reporting query. One day.

Total estimated effort: one focused week, parallelizable across phases 1 and 2.

---

## Files to add/modify

```
claude-mem/
├── src/
│   ├── index.ts          # add SSE transport + lite/full routing
│   └── tools/
│       └── lite.ts       # new: tier-1 tool definitions (thin wrappers)
├── hooks/                # new directory
│   ├── mem-capture.sh    # Stop hook: extract <remember> tags or summarize turn
│   ├── mem-precompact.sh # PreCompact hook: structured session export
│   ├── mem-inject.sh     # SessionStart hook: inject recent context briefing
│   └── mem-degradation.sh# PostToolUseFailure hook: log degradation signals
├── scripts/
│   └── start-sse.sh      # new: launch SSE server with env config
└── docs/
    └── multi-machine.md  # new: deployment guide for Tailscale + remote MCP
```

---

## Open questions

1. **Async queue implementation:** Fire-and-forget in bash can be done with `nohup ... &` or a named pipe. A more robust option is a small queue file that a persistent worker drains. What's the acceptable failure mode if the postgres write fails — silent drop, local fallback file, or retry queue?

2. **Project identity across machines:** Auto-memory uses absolute paths for project identity. claude-mem uses project names. Confirm the current project-identification logic in the MCP server handles identical git repos at different absolute paths across machines correctly (it should, since it's name-based not path-based, but worth verifying).

3. **`<remember>` tag scanning scope:** Should the `Stop` hook scan only Claude's most recent assistant turn, or the full turn including tool call outputs? Tool outputs can contain useful artifacts but also a lot of noise.

4. **Lite server as default:** Should the lite server become the default for all normal sessions (i.e., replace the current default connection), with full server only for explicit curation? Or keep full as default and let users opt into lite? Given the 60K token problem, lite-as-default seems correct — but it's a breaking change for any workflow that relies on the rich metadata tools being always available.
