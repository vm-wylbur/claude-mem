-- PostgreSQL Schema for Memory MCP Server with pgvector support
-- Author: PB and Claude
-- Date: 2025-07-01
-- License: (c) HRDAG, 2025, GPL-2 or newer

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Project information
CREATE TABLE IF NOT EXISTS projects (
    project_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Memory storage with pgvector embeddings
CREATE TABLE IF NOT EXISTS memories (
    memory_id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('conversation', 'code', 'decision', 'reference')),
    metadata JSONB NOT NULL DEFAULT '{}',
    embedding vector(768), -- 768 dimensions for nomic-embed-text
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_content_type ON memories(content_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING GIN(metadata);

-- pgvector similarity search index (HNSW for fast approximate search)
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);

-- Tag system
CREATE TABLE IF NOT EXISTS tags (
    tag_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many relationship between memories and tags
CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id INTEGER NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (memory_id, tag_id)
);

-- Memory relationships (e.g., "builds_on", "references", "contradicts")
CREATE TABLE IF NOT EXISTS memory_relationships (
    relationship_id SERIAL PRIMARY KEY,
    source_memory_id INTEGER NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    target_memory_id INTEGER NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

-- Indexes for relationships
CREATE INDEX IF NOT EXISTS idx_memory_relationships_source ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_target ON memory_relationships(target_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_type ON memory_relationships(relationship_type);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_memories_updated_at 
    BEFORE UPDATE ON memories 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default development project
INSERT INTO projects (name, description) 
VALUES (
    'memory-mcp-development',
    'Development history and decisions for the Memory MCP Server project'
) ON CONFLICT (name) DO NOTHING;