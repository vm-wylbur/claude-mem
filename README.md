# Memory MCP Server

A long-term memory storage system for LLMs using the Model Context Protocol (MCP) standard. This system helps LLMs remember the context of work done over the entire history of a project, even across multiple sessions. It uses semantic search with embeddings to provide relevant context from past interactions and development decisions.

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
- Ollama running locally (for embeddings)
  - Must have the `nomic-embed-text` model installed
- SQLite3

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
4. Create a `.env` file with required configuration:
   ```
   OLLAMA_HOST=http://localhost:11434
   DB_PATH=memory.db
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

## Database Schema

The system uses SQLite with the following tables:

### Core Tables
- `projects`: Project information and metadata
- `memories`: Memory entries storing various types of development context
- `embeddings`: Vector embeddings (768d) for semantic search capabilities

### Organization Tables
- `tags`: Memory organization tags
- `memory_tags`: Many-to-many relationships between memories and tags
- `memory_relationships`: Directed relationships between memory entries

## MCP Tools

The following tools are available through the MCP protocol:

### Memory Management
- `store-dev-memory`: Create new development memories with:
  - Content
  - Type (conversation/code/decision/reference)
  - Tags
  - Code changes
  - Files created/modified
  - Key decisions
  - Implementation status
- `list-dev-memories`: List existing memories with optional tag filtering
- `get-dev-memory`: Retrieve specific memory by ID
- `search`: Semantic search across memories using embeddings

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
- `better-sqlite3@^9.4.3`: SQLite database interface
- `node-fetch@^3.3.2`: HTTP client for Ollama API
- `zod@^3.22.4`: Runtime type checking and validation

## Project Structure

```
memory-mcp-server/
├── src/
│   ├── db/
│   │   ├── init.ts     # Database initialization
│   │   └── service.ts  # Database service layer
│   ├── dev-memory.ts   # Development memory helpers
│   ├── index.ts        # Main server implementation
│   └── schema.sql      # Database schema
├── dist/               # Compiled JavaScript
├── package.json        # Project configuration
└── tsconfig.json       # TypeScript configuration
```

## Contributing

Contributions are welcome! Please ensure you:
1. Write clear commit messages
2. Add appropriate documentation
3. Follow the existing code style
4. Add/update tests as needed 