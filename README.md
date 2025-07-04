# Claude Memory

A long-term memory storage system for Claude and other LLMs using the Model Context Protocol (MCP) standard. This system helps LLMs remember the context of work done over the entire history of a project, even across multiple sessions. It uses semantic search with embeddings to provide relevant context from past interactions and development decisions.

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

1. Start the server in development mode:
   ```bash
   npm run dev
   ```
   This will:
   - Compile TypeScript
   - Copy schema files
   - Start the server with auto-reload

2. The server connects via stdio for Cursor compatibility

### Important: Rebuilding After Changes

When you make code changes and want to launch a new Claude instance that uses the updated MCP server:

```bash
# Always rebuild before starting a new Claude session
npm run build

# Then launch your new Claude instance
# The MCP server will use the updated compiled code
```

**Why this matters**: Claude instances cache the MCP server binary. Without rebuilding, new Claude sessions will use the old version of your code and won't see recent changes like enhanced diagnostics or new tools.

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

## MCP Tools

The following tools are available through the MCP protocol:

### Memory Management
- `store-dev-memory`: Create detailed memories with metadata, tags, and relationships
- `quick-store`: Simple memory storage with auto-detection
- `list-dev-memories`: Browse recent memories with pagination
- `get-dev-memory`: Retrieve specific memory by ID
- `get-recent-context`: Get recent memories for session continuity

### Search & Discovery
- `search`: Basic semantic search using vector embeddings
- `search-enhanced`: Advanced search with filtering and scoring
- `get-all-tags`: Browse available tags for discovery
- `list-memories-by-tag`: Find memories by specific tags

### System
- `memory-overview`: System status, statistics, and usage guide

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
- `@modelcontextprotocol/sdk@^1.7.0`: MCP protocol implementation
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
│   ├── tools/          # MCP tool implementations
│   ├── utils/          # Utility functions
│   ├── config-toml.ts  # Configuration management
│   ├── index.ts        # Main server implementation
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