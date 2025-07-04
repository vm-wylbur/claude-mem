# Schema Differences: SQLite vs PostgreSQL

## Overview
This document outlines the key differences between the working SQLite and PostgreSQL schemas for the memory MCP server.

## Key Architectural Differences

### Memory ID Storage
- **SQLite**: `memory_id INTEGER PRIMARY KEY` (sequential)
- **PostgreSQL**: `memory_id TEXT PRIMARY KEY` (xxHash64 as string)
- **Why**: xxHash64 values exceed PostgreSQL's BIGINT range, requiring TEXT storage

### Vector Embeddings
- **SQLite**: Separate `embeddings` table with `BLOB` storage + foreign key reference
- **PostgreSQL**: Integrated `embedding VECTOR(768)` column using pgvector extension
- **Why**: PostgreSQL's pgvector provides native vector operations and indexing

### Metadata Storage
- **SQLite**: `metadata TEXT` (JSON as string)
- **PostgreSQL**: `metadata JSONB` with GIN indexing
- **Why**: PostgreSQL's JSONB enables rich querying and better performance

### Timestamps
- **SQLite**: `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- **PostgreSQL**: `TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
- **Why**: PostgreSQL's timezone-aware timestamps for distributed systems

## Migration Implications

### Schema Fixes Applied
1. **memory_id type**: Changed from BIGINT to TEXT in PostgreSQL schema
2. **updated_at column**: Added during migration to match code expectations
3. **Constraint adjustments**: Adapted CHECK constraints for PostgreSQL syntax

### Data Migration Notes
- Successfully migrated 63 memories from SQLite to PostgreSQL
- BLOB embeddings converted to pgvector format using custom Python script
- Foreign key relationships preserved through ID mapping

### Performance Differences
- **SQLite**: In-memory cosine similarity calculations
- **PostgreSQL**: Native pgvector `<->` distance operations with HNSW indexing
- **Result**: PostgreSQL provides faster similarity search at scale

## Files Reference
- `sqlite-working-schema.sql`: Current SQLite schema (63 memories)
- `postgresql-working-schema.sql`: Working PostgreSQL schema (66+ memories)
- `scripts/migrate-from-sqlite.py`: Migration script used