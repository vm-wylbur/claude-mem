-- PostgreSQL Schema for Claude Memory System with pgvector
-- Converted from SQLite schema.sql for PostgreSQL + pgvector integration

-- Project information
CREATE TABLE IF NOT EXISTS projects (
    project_id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Memory entries with integrated vector embeddings (conversations, code, decisions, etc.)
CREATE TABLE IF NOT EXISTS memories (
    memory_id BIGSERIAL PRIMARY KEY,
    project_id BIGINT REFERENCES projects(project_id),
    content TEXT NOT NULL,
    content_type TEXT CHECK(content_type IN ('conversation', 'code', 'decision', 'reference')),
    metadata JSONB, -- JSON field for additional metadata (better than TEXT in PostgreSQL)
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    embedding vector(768) -- pgvector integration - 768 dimensions for nomic-embed-text
);

-- Tags for additional metadata and organization
CREATE TABLE IF NOT EXISTS tags (
    tag_id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- Many-to-many relationship table for tagging memories
CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id BIGINT NOT NULL REFERENCES memories(memory_id),
    tag_id BIGINT NOT NULL REFERENCES tags(tag_id),
    PRIMARY KEY (memory_id, tag_id)
);

-- Relationships between memories
CREATE TABLE IF NOT EXISTS memory_relationships (
    relationship_id BIGSERIAL PRIMARY KEY,
    source_memory_id BIGINT NOT NULL REFERENCES memories(memory_id),
    target_memory_id BIGINT NOT NULL REFERENCES memories(memory_id),
    relationship_type TEXT NOT NULL -- e.g., 'references', 'builds_on', 'contradicts'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_content_type ON memories(content_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING gin(metadata); -- JSONB index

-- pgvector similarity search index (HNSW for cosine similarity)
CREATE INDEX IF NOT EXISTS idx_memories_embedding_cosine ON memories USING hnsw (embedding vector_cosine_ops);

-- Additional vector indexes for different distance metrics
CREATE INDEX IF NOT EXISTS idx_memories_embedding_l2 ON memories USING hnsw (embedding vector_l2_ops);