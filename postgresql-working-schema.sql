-- Working PostgreSQL Schema (extracted 2025-07-02)
-- This is the actual schema that works after migration fixes
-- Key difference: memory_id is TEXT (not BIGINT) to support xxHash64 values

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects table
CREATE TABLE projects (
    project_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Memories table (FIXED: memory_id as TEXT not BIGINT)
CREATE TABLE memories (
    memory_id TEXT PRIMARY KEY,  -- xxHash64 as string (CRITICAL FIX)
    project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('conversation', 'code', 'decision', 'reference')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,  -- ADDED during migration
    embedding VECTOR(768)  -- pgvector for semantic search
);

-- Tags table
CREATE TABLE tags (
    tag_id SERIAL PRIMARY KEY,
    tag_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Memory-Tag relationships
CREATE TABLE memory_tags (
    memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (memory_id, tag_id)
);

-- Memory relationships (references, builds_on, etc.)
CREATE TABLE memory_relationships (
    relationship_id SERIAL PRIMARY KEY,
    source_memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    target_memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

-- Indexes for performance
CREATE INDEX idx_memories_project_id ON memories(project_id);
CREATE INDEX idx_memories_content_type ON memories(content_type);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX idx_memories_metadata ON memories USING GIN(metadata);
CREATE INDEX idx_memories_embedding_cosine ON memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_memory_relationships_source ON memory_relationships(source_memory_id);
CREATE INDEX idx_memory_relationships_target ON memory_relationships(target_memory_id);

-- Sample development project (created during initialization)
INSERT INTO projects (name, description) VALUES 
('memory-mcp-development', 'Development project for MCP memory server')
ON CONFLICT (name) DO NOTHING;