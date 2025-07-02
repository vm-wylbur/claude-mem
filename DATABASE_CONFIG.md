# Database Configuration

The Memory MCP Server supports both SQLite and PostgreSQL backends with seamless switching through environment variables.

## SQLite (Default)

SQLite is the default database backend, perfect for development and lightweight deployments.

```bash
# Default configuration (no environment variables needed)
npm run dev

# Or explicitly set SQLite
MCPMEM_DB_TYPE=sqlite MCPMEM_DB_PATH=./memory.db npm run dev
```

## PostgreSQL with pgvector

PostgreSQL backend provides production-grade performance with native vector similarity search using pgvector.

### Prerequisites

1. PostgreSQL server with pgvector extension installed
2. SSH access to PostgreSQL host (if using tunnels)

### Configuration

```bash
# Set environment variables
export MCPMEM_DB_TYPE=postgresql
export MCPMEM_PG_HOSTS=snowl,snowball  # Comma-separated fallback hosts
export MCPMEM_PG_DATABASE=claude_mem
export MCPMEM_PG_USER=pball
export MCPMEM_PG_TUNNEL=true           # Enable SSH tunneling
export MCPMEM_PG_TUNNEL_PORT=5433      # Local tunnel port

# Initialize PostgreSQL database
npm run init:postgres

# Run with PostgreSQL
npm run dev
```

### SSH Tunnel Configuration

For secure connections, the system supports SSH tunnels with automatic failover:

```bash
# SSH configuration (optional environment variables)
export MCPMEM_SSH_USER=pball                    # SSH username (default: pball)
export MCPMEM_SSH_KEY_PATH=~/.ssh/id_rsa       # SSH private key path
```

The system will attempt to connect to hosts in order (snowl first, then snowball) and automatically establish SSH tunnels.

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MCPMEM_DB_TYPE` | `sqlite` | Database type: `sqlite` or `postgresql` |
| `MCPMEM_DB_PATH` | `./memory.db` | SQLite database file path |
| `MCPMEM_PG_HOSTS` | `snowl,snowball` | PostgreSQL hosts (comma-separated) |
| `MCPMEM_PG_DATABASE` | `claude_mem` | PostgreSQL database name |
| `MCPMEM_PG_USER` | `pball` | PostgreSQL username |
| `MCPMEM_PG_TUNNEL` | `false` | Enable SSH tunneling |
| `MCPMEM_PG_TUNNEL_PORT` | `5433` | Local port for SSH tunnel |
| `MCPMEM_SSH_USER` | `pball` | SSH username |
| `MCPMEM_SSH_KEY_PATH` | `~/.ssh/id_rsa` | SSH private key path |

## Features Comparison

| Feature | SQLite | PostgreSQL |
|---------|---------|------------|
| Vector Search | In-memory cosine similarity | Native pgvector operations |
| Metadata Queries | Basic JSON string matching | Rich JSONB queries |
| Performance | Good for development | Optimized for production |
| Deployment | Single file | Requires server |
| Concurrency | Limited | High concurrency support |
| Setup | Zero configuration | Requires initialization |

## Migration

The system maintains the same MCP interface regardless of backend. To migrate:

1. Export data from SQLite (if needed)
2. Initialize PostgreSQL database: `npm run init:postgres`
3. Switch environment variables to PostgreSQL
4. Restart the server

Both databases share the same schema structure and API, ensuring seamless migration.