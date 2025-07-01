# PostgreSQL Migration TODO

## Current State (Phase 1-3 Complete)
✅ Created `postgresql-migration` branch  
✅ Experimental directory: `/Users/pball/projects/personal/mcp-long-term-memory-pg/`  
✅ SQLite version continues running: `/Users/pball/src/mcp-long-term-memory/`  

## Phase 4: Migration Implementation

### 4.1 Database Setup
- [ ] Install pgvector extension on snowball: `ssh snowl "sudo -u postgres psql -c 'CREATE EXTENSION vector;'"`
- [ ] Create PostgreSQL schema equivalent to SQLite schema.sql
- [ ] Convert BLOB embeddings to `vector(768)` columns
- [ ] Add proper indexes for performance
- [ ] Create `memory_experimental` database

### 4.2 SSH Tunnel Management
- [ ] Research existing tunnel code from other project
- [ ] Implement connection fallback logic: snowl → snowball
- [ ] Add tunnel health checking and auto-reconnection
- [ ] Handle tunnel lifecycle (start, monitor, restart)

### 4.3 Application Changes
- [ ] Replace better-sqlite3 with `pg` (node-postgres)
- [ ] Update DatabaseService for PostgreSQL connection pooling
- [ ] Replace in-memory cosine similarity with pgvector `<->` operator
- [ ] Add environment variables for PostgreSQL connection
- [ ] Update MCP server name: `memory-server` → `memory-server-pg`

### 4.4 Configuration
- [ ] Update package.json name and main entry point
- [ ] Create new Warp MCP configuration for experimental server
- [ ] Set different ports/endpoints to avoid conflicts
- [ ] Add PostgreSQL-specific environment variables

### 4.5 Testing Strategy
- [ ] Start fresh (no data migration initially)
- [ ] Test basic memory operations: store, list, get, search
- [ ] Performance benchmarking vs SQLite
- [ ] Multi-client testing (multiple Claude instances)
- [ ] Network failure resilience testing

### 4.6 Future Migration (Later)
- [ ] Export existing SQLite memories to JSON
- [ ] Import historical memories to PostgreSQL
- [ ] Gradual cutover strategy
- [ ] Backup and rollback procedures

## Target Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Warp-Claude   │    │   SSH Tunnel     │    │   snowball      │
│                 │◄──►│ snowl/snowball   │◄──►│   PostgreSQL    │
│ memory-server-pg│    │ :5432            │    │   + pgvector    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Notes
- Keep SQLite version running during development
- Test thoroughly before switching production usage
- SSH tunnel reliability is critical for remote access
- Performance should be better than SQLite for concurrent access
