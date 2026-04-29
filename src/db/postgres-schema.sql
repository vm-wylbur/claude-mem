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

-- ==============================================================================
-- IaC Drift Queue: queue_fixes
-- ==============================================================================
-- Async write-back queue for direct fixes made on hosts that need to be
-- encoded into IaC (Ansible roles, repo configs). Writers append entries
-- when they make a direct change; the target_repo's agent drains entries
-- at session boundaries (not mid-session) to encode them as role/config
-- changes.
--
-- Intentionally NOT scoped to a project: queue is global, routed by
-- target_repo (string).

CREATE TABLE IF NOT EXISTS queue_fixes (
    id BIGSERIAL PRIMARY KEY,

    -- routing
    target_repo TEXT NOT NULL,           -- 'hrdag-ansible', 'tfcs', 'hmon', etc.

    -- what changed
    host TEXT NOT NULL,                  -- 'scott', 'lizo', etc.
    path TEXT NOT NULL,                  -- file path or 'systemd:foo.service' etc.
    before_state TEXT,                   -- nullable for creations
    after_state TEXT NOT NULL,
    why TEXT NOT NULL,

    -- optional hints for the drainer
    suggested_role TEXT,

    -- provenance
    who TEXT NOT NULL,                   -- 'PB', 'cc-tfcs', etc.
    trust TEXT,                          -- 'PB' = fast-lane; NULL = investigate

    -- lifecycle
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'consumed', 'escalated', 'superseded')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- outcome (filled when status changes)
    consumed_at TIMESTAMP,
    consumed_by_commit TEXT,
    consumed_in_repo TEXT,
    consumed_in_path TEXT,
    escalation_reason TEXT,
    superseded_by BIGINT REFERENCES queue_fixes(id),

    -- extension point
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_qf_target_status_created
    ON queue_fixes(target_repo, status, created_at);
CREATE INDEX IF NOT EXISTS idx_qf_host ON queue_fixes(host);
CREATE INDEX IF NOT EXISTS idx_qf_metadata ON queue_fixes USING GIN(metadata);