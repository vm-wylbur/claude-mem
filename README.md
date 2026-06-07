# Claude Memory

A long-term memory store for Claude and other LLM sessions, served over a small REST API backed by PostgreSQL + pgvector. It helps LLMs remember the context of work done over the whole history of a project, across sessions, using semantic search over embeddings of past interactions and decisions.

Clients reach it through the REST endpoints (`/store`, `/recent`, `/search`, `/docs`, `/qfix-*`) — typically via thin shell shims (`~/.claude/lib/mem-*.sh`) called from Claude Code hooks and skills. The earlier MCP transport has been retired (issue #4); REST is the sole client surface.

## Features

- Project-based memory organization
- Semantic search using Ollama embeddings (nomic-embed-text model, 768 dimensions)
- Multiple memory types:
  - Conversations: Dialog context and important discussions
  - Code: Implementation details and changes
  - Decisions: Key architectural and design choices
  - References: Links to external resources and documentation
- Rich metadata storage including:
  - Implementation status
  - Key decisions
  - Files created/modified
  - Code changes
  - Dependencies added
- Tagging system for memory organization
- Relationship tracking between memories

## Prerequisites

- Node.js (v18 or later)
- PostgreSQL database with pgvector extension
- Ollama running locally (for embeddings)
  - Must have the `nomic-embed-text` model installed

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Configure the system:
   ```bash
   # Copy example configuration
   mkdir -p ~/.config/claude-mem
   cp claude-mem.toml.example ~/.config/claude-mem/claude-mem.toml
   
   # Edit configuration for your setup
   # See DATABASE_CONFIG.md for detailed setup instructions
   ```

## Usage

The HTTP server (`dist/index-http.js`) is the only entry point. It binds `0.0.0.0:${CLAUDE_MEM_PORT:-3456}` and serves the REST API.

1. Build, then start:
   ```bash
   npm run build
   npm start          # == node dist/index-http.js
   ```

2. In production it runs as a systemd service on the host that owns PostgreSQL (`scripts/claude-mem-http.service`), and clients reach it over Tailscale.

### Auth

If `CLAUDE_MEM_SECRET` is set, every request must carry `X-Claude-Mem-Secret: <secret>`. This is a belt-and-suspenders check on top of the Tailscale network boundary; unset it only for a fully trusted local loopback.

### Rebuilding after changes

`npm run build` recompiles TypeScript and copies the schema + migration files into `dist/`. Restart the service (`systemctl restart claude-mem-http`) to pick up the new build.

## Configuration

Claude Memory uses TOML configuration files for flexible setup:

- **Primary config**: `~/.config/claude-mem/claude-mem.toml`
- **Example**: `claude-mem.toml.example` (copy and customize)
- **Documentation**: See `DATABASE_CONFIG.md` for detailed setup

### Quick Setup
```bash
# PostgreSQL with environment variable
MCPMEM_DB_TYPE=postgresql npm run dev

# Or configure via TOML file (recommended)
cp claude-mem.toml.example ~/.config/claude-mem/claude-mem.toml
# Edit the TOML file for your database settings
npm run dev
```

## Database

Claude Memory uses PostgreSQL with pgvector for high-performance semantic search:

### Core Tables
- `projects`: Project information and metadata
- `memories`: Memory entries with vector embeddings (768d)
- `tags`: Memory organization and categorization
- `memory_tags`: Memory-tag relationships
- `memory_relationships`: Links between related memories

### Features
- Native pgvector similarity search
- JSONB metadata storage
- Full-text search capabilities
- Transactional consistency

## REST API

All endpoints accept/return JSON and require the `X-Claude-Mem-Secret` header when the server has a secret configured.

### Memories
- `POST /store` — store a memory. Body `{content, tags?, source_key?}`. `source_key` makes the write an upsert (re-store under the same key edits in place + re-embeds).
- `GET /recent?project=&n=` — recent memories (returns tags). Without `project`, returns the recent-context view.
- `POST /search` — semantic search over memory embeddings. Body `{query, limit?}` → `{memories:[…]}` (content + metadata + similarity; no tags).

### Doc harvester (lessons_learned_docs)
- `GET /docs/manifest` — change-detection manifest for the distiller.
- `GET /docs/backlog?limit=&offset=` — undistilled-doc worklist (deduped by `doc_hash`).
- `GET /docs/:doc_id` — one raw doc with full content.
- `POST /docs` — upsert a raw doc. `doc_hash` is derived server-side from `content` (issue #6); a client-sent value is accepted for back-compat but ignored.
- `POST /harvest` — store a distilled memory linked to its `source_doc_id`.
- `POST /decision` — log a keep/edit/skip extraction decision into the labeled set.

### IaC drift queue (queue_fixes)
- `POST /qfix-store` — record a host fix that needs encoding into IaC.
- `GET /qfix-list?target_repo=&status=&host=&limit=` — list entries (FIFO).
- `POST /qfix-mark` — mark an entry consumed / escalated / superseded.

## Development

For development:
```bash
npm run dev
```

This will:
1. Kill any existing server instances
2. Rebuild the TypeScript code
3. Copy the schema.sql to the dist directory
4. Start the server in development mode

## Dependencies

Key dependencies:
- `express@^5.1.0`: HTTP server for the REST API
- `pg@^8.16.3`: PostgreSQL database interface
- `toml@^3.0.0`: Configuration file parsing
- `xxhash-wasm@^1.1.0`: Fast hash generation
- `node-fetch@^3.3.2`: HTTP client for Ollama API
- `zod@^3.22.4`: Runtime type checking and validation

## Project Structure

```
claude-mem/
├── src/
│   ├── db/
│   │   ├── adapters/   # Database adapters (PostgreSQL)
│   │   ├── init.ts     # Database initialization
│   │   └── service.ts  # Database service layer
│   ├── tools/          # Shared content classifiers + the REST-reused store/recent helpers
│   ├── utils/          # Utility functions
│   ├── config-toml.ts  # Configuration management
│   ├── index-http.ts   # HTTP/REST server (the sole entry point)
│   └── schema.sql      # Database schema
├── docs/
│   ├── archives/       # Historical documentation
│   └── future-bluesky/ # Vision documents
├── dist/               # Compiled JavaScript
├── DATABASE_CONFIG.md  # Setup instructions
├── claude-mem.toml.example # Configuration template
├── package.json        # Project configuration
└── tsconfig.json       # TypeScript configuration
```

## Deploying as a shared service

claude-mem runs as a single long-lived HTTP service on the host that owns PostgreSQL; every client (across machines) reaches it over Tailscale. There is no per-client server process and no MCP registration.

#### Server side

```bash
# 1. Build
cd ~/projects/claude-mem
npm run build

# 2. Install/refresh the systemd unit (scripts/claude-mem-http.service)
#    ExecStart = node dist/index-http.js ; set CLAUDE_MEM_SECRET in the unit env.
systemctl restart claude-mem-http
systemctl status claude-mem-http
```

#### Client side

Clients call the REST API directly — the reference clients are the `~/.claude/lib/mem-*.sh` shims, which `curl` the endpoints and send `X-Claude-Mem-Secret`. A minimal round-trip:

```bash
curl -s -H "X-Claude-Mem-Secret: $CLAUDE_MEM_SECRET" \
  -H 'content-type: application/json' \
  -d '{"query":"how did we fix the body-limit bug","limit":3}' \
  http://snowball.tailnet:3456/search
```

#### After code changes

Rebuild and restart the service; clients need no changes (they only know the URL + secret):
```bash
cd ~/projects/claude-mem && npm run build && systemctl restart claude-mem-http
```

## Skills

Claude Code skills enhance development workflows by automating common patterns. This project includes a **memory-augmented-dev** skill that integrates with the REST memory service.

### Installing Skills

Skills are installed at the **user level** (not per-project):

```bash
# Copy the memory-augmented development skill
cp -r skills/memory-augmented-dev ~/.claude/skills/

# Verify installation
ls -la ~/.claude/skills/
```

### memory-augmented-dev Skill

**Purpose:** Search memory before coding, apply past learnings, document new work

**Activates when:** Implementing features, fixing bugs, refactoring code

**Workflow:**
1. **Research Phase:** Searches memory for relevant patterns and past decisions
2. **Implementation Phase:** Applies established patterns and avoids documented mistakes
3. **Documentation Phase:** Stores new learnings with rich metadata for future reference

**Example:**
```
User: "Add JWT authentication to the API"

Skill automatically:
1. Searches memory for past auth implementations
2. Reviews past security decisions
3. Suggests applying established patterns
4. After completion, stores the implementation details
```

See `skills/README.md` for more details on available skills and usage.

## Contributing

Contributions are welcome! Please ensure you:
1. Write clear commit messages
2. Add appropriate documentation
3. Follow the existing code style
4. Add/update tests as needed

## Acknowledgements

This project builds upon the foundational work of others in the MCP memory ecosystem:

- **Original Foundation**: [mcp-long-term-memory](https://github.com/tomschell/mcp-long-term-memory) by @tomschell provided the initial MCP memory server implementation and core concept
- **Design Inspiration**: [mcp-mem0](https://github.com/coleam00/mcp-mem0) by @coleam00 provided valuable insights for natural language memory capture and user experience enhancements

We've added PostgreSQL support with pgvector, hash-based memory IDs, and TOML configuration.