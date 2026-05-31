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
    source_key TEXT, -- stable upsert key for file-mirrored memories (Track 2b); NULL = content-hash dedup
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

-- source_key: stable upsert key for file-mirrored memories (Track 2b).
-- The ALTER makes this idempotent for databases initialized before the
-- column existed (CREATE TABLE IF NOT EXISTS above is a no-op on them).
-- Partial unique index = unique among non-null keys, unlimited NULLs, so
-- re-storing an edited memory file updates in place while unkeyed memories
-- are unaffected. Pairs with ON CONFLICT (source_key) WHERE source_key IS NOT NULL.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_source_key
    ON memories(source_key) WHERE source_key IS NOT NULL;

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

-- Trigger to automatically update updated_at.
-- Guarded with DROP IF EXISTS so re-running this file on an existing DB is
-- idempotent: a bare CREATE TRIGGER errors if it already exists, which would
-- abort the rest of the script (including the harvest tables added below).
DROP TRIGGER IF EXISTS update_memories_updated_at ON memories;
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

-- ==============================================================================
-- Document harvest tier: lessons_learned_docs, extraction_decisions, git_commits
-- ==============================================================================
-- Captured 2026-05-31 from the live claude_mem DB, where these tables exist and
-- carry data (304 / 115 / 182 rows) but had drifted OUT of this committed schema
-- -- a re-init would not have recreated them. See docs/harvester-plan-20260531.md.
--
-- NOTE: broader drift remains beyond this fix -- the live memories.memory_id is
-- TEXT (xxHash hex, per migrate-to-hash-ids) while this file still declares it
-- SERIAL. The tables below match the live types (TEXT memory references).

-- Tier 1: raw markdown docs (the harvest corpus of record). doc_hash (blake3 of
-- content) is the content-level change/dedup key; filepath is per-path provenance.
CREATE TABLE IF NOT EXISTS lessons_learned_docs (
    doc_id TEXT PRIMARY KEY,                  -- blake3 of filepath
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,                    -- full markdown
    file_mtime TIMESTAMPTZ NOT NULL,
    doc_hash TEXT NOT NULL,                   -- blake3 of content
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_docs_filepath   ON lessons_learned_docs(filepath);
CREATE INDEX IF NOT EXISTS idx_docs_created_at ON lessons_learned_docs(created_at);
CREATE INDEX IF NOT EXISTS idx_docs_file_mtime ON lessons_learned_docs(file_mtime);
CREATE INDEX IF NOT EXISTS idx_docs_doc_hash   ON lessons_learned_docs(doc_hash);

-- Provenance: link a distilled memory back to its source doc. Split the
-- column-add from the FK (like source_key above) so this is idempotent on a DB
-- where the column already exists WITHOUT the constraint: ADD COLUMN's inline
-- REFERENCES only fires when the column is first created, so a pre-existing
-- plain column (as on live before 2026-05-31) would never gain the FK.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_doc_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_source_doc_id_fkey') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_source_doc_id_fkey
      FOREIGN KEY (source_doc_id) REFERENCES lessons_learned_docs(doc_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_memories_source_doc_id ON memories(source_doc_id);

-- The labeled set: one row per proposed insight, recording the human decision
-- (approved / edited / skipped + reason). Seeds and grades the distiller.
CREATE TABLE IF NOT EXISTS extraction_decisions (
    decision_id BIGSERIAL PRIMARY KEY,
    doc_id TEXT REFERENCES lessons_learned_docs(doc_id),
    doc_filename TEXT NOT NULL,
    insight_number INTEGER NOT NULL,
    insight_title TEXT,
    insight_content TEXT NOT NULL,
    insight_tags TEXT[],
    action TEXT NOT NULL CHECK (action IN ('approved', 'edited', 'skipped')),
    edited_content TEXT,                      -- human-corrected text, when edited
    skip_reason TEXT,                         -- why rejected, when skipped
    stored_memory_id TEXT,                    -- memory created, when approved/edited
    "timestamp" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_extraction_decisions_action    ON extraction_decisions(action);
CREATE INDEX IF NOT EXISTS idx_extraction_decisions_doc_id    ON extraction_decisions(doc_id);
CREATE INDEX IF NOT EXISTS idx_extraction_decisions_timestamp ON extraction_decisions("timestamp" DESC);
-- Retry/re-decision idempotency: one current decision per (doc_id, insight_number),
-- the arbiter for the writer's ON CONFLICT. A POST /decision that commits server-side
-- but times out client-side must not double-log on retry -- the labeled set is the
-- product. NULLS DISTINCT (default) exempts doc-less rows (doc_id IS NULL); the
-- harvester always supplies doc_id, so it gets the dedup. Positional key: a
-- re-distillation that changes a doc's insight count can leave stale high-numbered
-- rows -- revisit when the distiller's re-run policy is defined. Dry-run-verified
-- (rolled-back txn) to build clean against live's 115 seed rows on 2026-05-31 --
-- 0 dups on the non-null pair; apply to live before deploying the ON CONFLICT writer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_extraction_decisions_doc_insight
    ON extraction_decisions(doc_id, insight_number);

-- git_commits: git-integration feature, independent of the doc harvester.
CREATE TABLE IF NOT EXISTS git_commits (
    id SERIAL PRIMARY KEY,
    memory_id VARCHAR(255) NOT NULL UNIQUE,
    content TEXT NOT NULL,
    content_type VARCHAR(50) DEFAULT 'git_commit',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    tags JSONB DEFAULT '[]',
    sentiment VARCHAR(20) DEFAULT 'neutral',
    complexity VARCHAR(20) DEFAULT 'low',
    embedding vector(768),
    commit_hash VARCHAR(255) NOT NULL UNIQUE,
    repository_name VARCHAR(255) NOT NULL,
    commit_type VARCHAR(50) NOT NULL,
    author_name VARCHAR(255),
    files_changed INTEGER DEFAULT 0,
    lines_added INTEGER DEFAULT 0,
    lines_deleted INTEGER DEFAULT 0,
    primary_language VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS git_commits_created_at_idx ON git_commits(created_at);
CREATE INDEX IF NOT EXISTS git_commits_embedding_idx  ON git_commits USING ivfflat (embedding vector_cosine_ops) WITH (lists = '100');
CREATE INDEX IF NOT EXISTS git_commits_repository_idx ON git_commits(repository_name);
CREATE INDEX IF NOT EXISTS git_commits_type_idx       ON git_commits(commit_type);