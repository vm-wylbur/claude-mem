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

-- ==============================================================================
-- Lessons-Learned Documentation Storage
-- ==============================================================================
-- Simple 2-layer approach:
-- Layer 1: Full documentation files (reference/source of truth)
-- Layer 2: Extracted insights in memories table (searchable knowledge)

-- Full documentation files (lessons-learned markdown docs)
CREATE TABLE IF NOT EXISTS lessons_learned_docs (
    doc_id TEXT PRIMARY KEY,                -- blake3 hash of filepath
    filename TEXT NOT NULL,                 -- "bad-recovery-drive.md"
    filepath TEXT NOT NULL UNIQUE,          -- "/home/pball/docs/bad-recovery-drive.md"
    content TEXT NOT NULL,                  -- Full markdown content
    file_mtime TIMESTAMPTZ NOT NULL,       -- Source file modification time
    doc_hash TEXT NOT NULL,                 -- blake3 hash of content for change detection
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'             -- {word_count, extracted_insights_count, topics}
);

-- Link memories to source documentation
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_doc_id TEXT REFERENCES lessons_learned_docs(doc_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_docs_filepath ON lessons_learned_docs(filepath);
CREATE INDEX IF NOT EXISTS idx_docs_created_at ON lessons_learned_docs(created_at);
CREATE INDEX IF NOT EXISTS idx_docs_file_mtime ON lessons_learned_docs(file_mtime);
CREATE INDEX IF NOT EXISTS idx_docs_doc_hash ON lessons_learned_docs(doc_hash);
CREATE INDEX IF NOT EXISTS idx_memories_source_doc_id ON memories(source_doc_id);

-- ==============================================================================
-- IaC Drift Queue: queue_fixes
-- ==============================================================================
-- Async write-back queue for direct fixes made on hosts that need to be
-- encoded into IaC (Ansible roles, repo configs). Writers append entries
-- when they make a direct change; the target repo's agent drains entries
-- at session boundaries (not mid-session) to encode them as role/config
-- changes.
--
-- This is intentionally NOT scoped to a project: queue is global, and
-- entries are routed by target_repo (string).

CREATE TABLE IF NOT EXISTS queue_fixes (
    id BIGSERIAL PRIMARY KEY,

    -- routing
    target_repo TEXT NOT NULL,           -- 'hrdag-ansible', 'tfcs', 'hmon', etc.

    -- what changed
    host TEXT NOT NULL,                  -- 'scott', 'lizo', etc.
    path TEXT NOT NULL,                  -- file path, or 'systemd:foo.service', etc.
    before_state TEXT,                   -- nullable when entry describes a creation
    after_state TEXT NOT NULL,
    why TEXT NOT NULL,

    -- optional hints for the drainer
    suggested_role TEXT,

    -- provenance
    who TEXT NOT NULL,                   -- 'PB', 'cc-tfcs', etc.
    trust TEXT,                          -- 'PB' = fast-lane; NULL or other = investigate

    -- lifecycle
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'consumed', 'escalated', 'superseded')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- outcome (filled when status changes)
    consumed_at TIMESTAMPTZ,
    consumed_by_commit TEXT,             -- git hash where the encode landed
    consumed_in_repo TEXT,
    consumed_in_path TEXT,
    escalation_reason TEXT,
    superseded_by BIGINT REFERENCES queue_fixes(id),

    -- extension point
    metadata JSONB DEFAULT '{}'
);

-- Drain query is `WHERE target_repo=$1 AND status=$2 ORDER BY created_at`
CREATE INDEX IF NOT EXISTS idx_qf_target_status_created
    ON queue_fixes(target_repo, status, created_at);
CREATE INDEX IF NOT EXISTS idx_qf_host ON queue_fixes(host);
CREATE INDEX IF NOT EXISTS idx_qf_metadata ON queue_fixes USING gin(metadata);