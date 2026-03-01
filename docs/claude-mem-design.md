# Design: Hooks integration, remote MCP over Streamable HTTP, and progressive tool disclosure

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

## Problem 2: Remote MCP over Streamable HTTP for multi-machine access

### Current state

Each machine runs `node dist/index.js` locally over stdio, all connecting to the same central PostgreSQL. This works but means each machine independently manages its MCP server process, and hooks on one machine can't call memory tools from a hook script without a network endpoint.

### Proposed solution: Streamable HTTP transport on the central server

SSE transport (`SSEServerTransport`) is deprecated in the MCP TypeScript SDK as of v1.10.0 (April 2025) and should not be used for new implementations. The replacement is `StreamableHTTPServerTransport`, which uses a single `/mcp` endpoint for all communication — POST for client requests, GET for server-initiated SSE streams, DELETE for session termination. Claude Code uses `"type": "http"` in client config to connect to it.

**Dependencies to add:**

```bash
npm install @modelcontextprotocol/express express
# or use the bare Node.js middleware:
# npm install @modelcontextprotocol/node
```

The SDK publishes optional thin middleware packages for Express, Hono, and plain Node.js HTTP. Use `@modelcontextprotocol/express` — it's the lowest-friction path given express is already a common dependency.

**Server-side change** (`src/index-http.ts` — new file, keep `index.ts` for stdio):

```typescript
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// Shared DB service — same pool used by stdio server
import { createDbService } from './db/service.js';
import { registerLiteTools, registerFullTools } from './tools/index.js';

const db = await createDbService();
const app = express();
app.use(express.json());

// Auth middleware — Tailscale is the network layer; this is belt-and-suspenders
app.use((req, res, next) => {
  const secret = process.env.CLAUDE_MEM_SECRET;
  if (secret && req.headers['x-claude-mem-secret'] !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

// Session store — maps session IDs to transports
const transports = new Map<string, StreamableHTTPServerTransport>();

function makeHandler(serverFactory: () => McpServer) {
  return async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST' && !sessionId) {
      // New session — must be an initialize request
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ error: 'expected initialize request' });
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport),
      });
      transport.onclose = () => transports.delete(transport.sessionId!);
      const server = serverFactory();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Existing session
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  };
}

// Lite endpoint — tier-1 tools only (normal coding sessions)
const liteHandler = makeHandler(() => {
  const server = new McpServer({ name: 'claude-mem-lite', version: '1.0.0' });
  registerLiteTools(server, db);
  return server;
});
app.all('/mcp', liteHandler);         // default endpoint
app.all('/mcp/lite', liteHandler);    // explicit alias

// Full endpoint — all tools (curation sessions)
app.all('/mcp/full', makeHandler(() => {
  const server = new McpServer({ name: 'claude-mem-full', version: '1.0.0' });
  registerFullTools(server, db);
  return server;
}));

const PORT = process.env.CLAUDE_MEM_PORT ?? 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`claude-mem HTTP server listening on :${PORT}`);
});
```

Run this on the machine that hosts PostgreSQL (or any always-on Tailnet node). One process serves all client machines.

**Client-side config** — `"type": "http"`, not `"type": "sse"`:

```bash
# Add to user scope (all projects, all sessions)
claude mcp add --transport http --scope user claude-mem \
  http://db-host.tailnet:3456/mcp \
  --header "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET}"
```

Or directly in `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-mem": {
      "type": "http",
      "url": "http://db-host.tailnet:3456/mcp",
      "headers": {
        "X-Claude-Mem-Secret": "${CLAUDE_MEM_SECRET}"
      }
    }
  }
}
```

`${CLAUDE_MEM_SECRET}` expands from the environment at connection time — the secret never appears in plaintext in config files. Set it in `~/.bashrc` or via your dotfiles sync.

**Known issue:** Claude Code v1.0.108 had a bug where configured headers were ignored and OAuth discovery was attempted instead (GitHub issue #7290). Verify your Claude Code version handles headers correctly before depending on them. Tailscale network-layer auth alone is sufficient if header auth proves unreliable — the `secret` check in the middleware is optional.

**Deployment:** Add `start:http` to `package.json` scripts:

```json
"scripts": {
  "start:stdio": "node dist/index.js",
  "start:http": "node dist/index-http.js"
}
```

Run under systemd on the DB host. Keep the stdio server available unchanged for local dev.

**Why not Supergateway?** It wraps stdio in a separate process with an HTTP shim, adding a process boundary and making debugging harder. Native `StreamableHTTPServerTransport` is the correct path — same codebase, forward-compatible transport.

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
# "url": "http://db-host.tailnet:3456/mcp"  ← hits the lite handler by default

# Curation session — add tier 2 for this session only
claude mcp add --transport http --scope local claude-mem-full \
  http://db-host.tailnet:3456/mcp/full \
  --header "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET}"
```

**Implementation:** The Streamable HTTP server from Problem 2 routes `/mcp` (default/lite) and `/mcp/full` to different server instances sharing the same DB connection pool — see the `makeHandler` pattern in Problem 2. `/mcp` and `/mcp/lite` both hit `registerLiteTools`; `/mcp/full` hits `registerFullTools`.

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

**Phase 1: Streamable HTTP transport** — enables everything else. Without a network endpoint, hooks can't call memory tools from client machines. Two days of work: add `@modelcontextprotocol/express` + `StreamableHTTPServerTransport`, test across two machines, deploy under systemd.

**Phase 2: Progressive disclosure** — split into lite/full servers, audit schema verbosity, measure token reduction. Can be done in parallel with Phase 1 once the SSE routing is working. One day of work.

**Phase 3: Hooks** — write the three hook scripts (`mem-capture.sh`, `mem-precompact.sh`, `mem-inject.sh`), add `<remember>` convention to CLAUDE.md/skill, test fire-and-forget async pattern. Deploy to all machines via dotfiles sync. Two to three days including tuning.

**Phase 4: Degradation tracking** — add `PostToolUseFailure` hook, tag schema for degradation signals, basic reporting query. One day.

Total estimated effort: one focused week, parallelizable across phases 1 and 2.

---

## Files to add/modify

```
claude-mem/
├── src/
│   ├── index.ts          # unchanged: stdio transport
│   ├── index-http.ts     # new: StreamableHTTP server (lite + full endpoints)
│   └── tools/
│       ├── index.ts      # refactor: export registerLiteTools, registerFullTools
│       └── lite.ts       # new: tier-1 tool definitions (thin wrappers)
├── hooks/                # new directory
│   ├── mem-capture.sh    # Stop hook: extract <remember> tags or summarize turn
│   ├── mem-precompact.sh # PreCompact hook: structured session export
│   ├── mem-inject.sh     # SessionStart hook: inject recent context briefing
│   └── mem-degradation.sh# PostToolUseFailure hook: log degradation signals
├── scripts/
│   └── claude-mem-http.service  # new: systemd unit for HTTP server
└── docs/
    └── multi-machine.md  # new: deployment guide for Tailscale + remote MCP
```

---

## Open questions

1. **Async queue implementation:** Fire-and-forget in bash can be done with `nohup ... &` or a named pipe. A more robust option is a small queue file that a persistent worker drains. What's the acceptable failure mode if the postgres write fails — silent drop, local fallback file, or retry queue?

2. **Project identity across machines:** Auto-memory uses absolute paths for project identity. claude-mem uses project names. Confirm the current project-identification logic in the MCP server handles identical git repos at different absolute paths across machines correctly (it should, since it's name-based not path-based, but worth verifying).

3. **`<remember>` tag scanning scope:** Should the `Stop` hook scan only Claude's most recent assistant turn, or the full turn including tool call outputs? Tool outputs can contain useful artifacts but also a lot of noise.

4. **Lite server as default:** Should the lite server become the default for all normal sessions (i.e., replace the current default connection), with full server only for explicit curation? Or keep full as default and let users opt into lite? Given the 60K token problem, lite-as-default seems correct — but it's a breaking change for any workflow that relies on the rich metadata tools being always available.
