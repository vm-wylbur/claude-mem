# Database Configuration

The Memory MCP Server uses PostgreSQL with pgvector for production-grade performance and native vector similarity search.

## PostgreSQL with pgvector

### Prerequisites

1. PostgreSQL server with pgvector extension installed
2. Network access to PostgreSQL host

### Configuration

Configure via TOML file at `~/.config/claude-mem/claude-mem.toml` or environment variables:

```bash
# Set environment variables
export MCPMEM_PG_HOSTS=your-postgres-host.com
export MCPMEM_PG_DATABASE=claude_mem
export MCPMEM_PG_USER=your_username
export MCPMEM_PG_PASSWORD=your_password
export MCPMEM_PG_SSLMODE=require

# Initialize PostgreSQL database
npm run init:postgres

# Run with PostgreSQL
npm run dev
```

### TOML Configuration

Create `~/.config/claude-mem/claude-mem.toml`:

```toml
[database]
type = "postgresql"

[database.postgresql]
hosts = ["your-postgres-host.com"]
database = "claude_mem"
user = "your_username"
password = "your_password"
port = 5432
sslmode = "require"
max_connections = 5
connection_timeout_ms = 5000
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MCPMEM_PG_HOSTS` | `localhost` | PostgreSQL hosts (comma-separated for fallback) |
| `MCPMEM_PG_DATABASE` | `claude_mem` | PostgreSQL database name |
| `MCPMEM_PG_USER` | `pball` | PostgreSQL username |
| `MCPMEM_PG_PASSWORD` | - | PostgreSQL password |
| `MCPMEM_PG_PORT` | `5432` | PostgreSQL port |
| `MCPMEM_PG_SSLMODE` | - | SSL mode (require, disable, etc.) |

## Features

| Feature | Description |
|---------|-------------|
| Vector Search | Native pgvector operations for semantic similarity |
| Metadata Queries | Rich JSONB queries with GIN indexing |
| Performance | Optimized for production workloads |
| Concurrency | High concurrency support via connection pooling |
