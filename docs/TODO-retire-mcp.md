<!--
Author: PB and Claude
Date: 2026-05-30
License: (c) HRDAG, 2026, GPL-2 or newer

---
claude-mem/docs/TODO-retire-mcp.md
-->

# TODO — retire the MCP surface

**Status:** open · filed 2026-05-30

## Context

Clients no longer use the MCP transport. As of the dotfiles
composable-artifacts Phase 4 migration (2026-05), every caller reaches
claude-mem through the **REST endpoints** (`/store`, `/recent`, `/search`)
via the `~/.claude/lib/mem-*.sh` shell shims. The `claude-mem` MCP server
entry was removed from client `~/.claude.json`.

The claude-mem repo, however, still ships the full MCP server surface:

- `src/index-http.ts` — `/mcp` and `/mcp/full` routes + `makeHandler`
  (StreamableHTTP transport, session map).
- `src/server.ts` — `createServer` / `createLiteServer` MCP factories.
- MCP SDK dependency (`@modelcontextprotocol/sdk`) in `package.json`.
- MCP-focused tests (`tests/mcp-server-integration.test.ts`,
  `tests/real-mcp-integration.test.ts`, etc.).
- README documents MCP client config as the primary integration path.

This is dead weight: maintenance surface, dependency footprint, and
documentation that points new integrators at a transport we don't use.

## What to retire (keep the REST layer)

The load-bearing surface is the REST API (`/store`, `/recent`, `/search`)
on snowball:3456 + the postgres+pgvector backend. **Do not touch those.**
Retire only the MCP-specific layer:

1. Remove `/mcp` and `/mcp/full` routes + `makeHandler` from `index-http.ts`.
2. Remove `createServer` / `createLiteServer` MCP factories (or reduce
   `server.ts` to the shared store/search helpers the REST layer reuses).
3. Drop `@modelcontextprotocol/sdk` from `package.json` once nothing imports it.
4. Delete or rewrite the MCP-integration tests; keep REST-endpoint tests.
5. Rewrite README integration section to document the REST + lib-shim path.

## Why now

claude-mem's own roadmap (`claude-mem-analysis-and-roadmap.md`) frames it as
"best-in-class for layer #1 (data); build layers #2 and #3 (workflow +
orchestration)." Those layers are now being built in dotfiles (MEMORY.md →
claude-mem mirror; `/recall` skill). Retiring the unused MCP surface keeps
the data layer lean while that work lands. **Pairs with the dotfiles Track 2
upsert change** — the `/store` `source_key` upsert is the next REST-side edit;
do the MCP retirement in the same pass or right after.

## Success condition

This is resolved when:

- `grep -rn "/mcp" src/` returns no route registrations, AND
- `npm run build && npm test` is green with the REST endpoints
  (`/store`, `/recent`, `/search`) still passing their tests, AND
- the running snowball service answers `/store`, `/recent`, `/search`
  unchanged (verified by a `lib/mem-*.sh` round-trip from a client).
