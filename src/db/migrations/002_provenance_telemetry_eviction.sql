-- Author: PB and Claude
-- Date: 2026-06-07
-- License: (c) HRDAG, 2026, GPL-2 or newer
--
-- claude-mem/src/db/migrations/002_provenance_telemetry_eviction.sql
--
-- Phase-A substrate for the neg-2baa74e7 task split + its ratified E2b
-- amendment (claude-mem/docs ~/docs/claude-mem/). One migration, all
-- memories-adjacent, additive + idempotent:
--
--   * provenance-on-write  : session_id / host / agent_id (typed, indexed) +
--     a provenance jsonb forward-compat escape hatch. The typed session_id is
--     the episode handle that later closes the confirmed-miss loop.
--   * A2 timestamps         : ensure created_at/updated_at are timestamptz AND
--     that updated_at actually bumps on mutation (live had NO trigger -> it was
--     a dead default; E1's change-signal depends on this).
--   * eviction tombstone    : evicted_at (recoverable, not erase). The read-path
--     "AND evicted_at IS NULL" sweep lives in the search functions + adapters,
--     NOT here; this only adds the column + a partial-friendly index.
--   * miss-telemetry        : search_events + search_candidates (typed, no jsonb)
--     and search_hybrid_candidates() -- the boundary capture. Telemetry sees
--     PRE-eviction rows (no evicted_at filter here, deliberately) so an
--     eviction-caused miss stays visible to the regression guard.
--
-- Idempotent: safe to re-run. On live (already timestamptz, 001 applied) the
-- tz block is a no-op and the search_hybrid re-create is harmless.

-- ── provenance-on-write ──────────────────────────────────────────────
ALTER TABLE memories ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS host       TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id   TEXT;
-- provenance jsonb: forward-compat ONLY. Linkage-bearing fields are typed
-- columns above (you join/filter on them); jsonb is for genuinely open-ended
-- provenance that nothing downstream queries.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS provenance JSONB;
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent_id   ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_host       ON memories(host);

-- ── A2: timestamptz + a live updated_at bump ─────────────────────────
-- Convert ONLY if a pre-tz fresh init left these naive (live is already tztz,
-- server tz = UTC, so AT TIME ZONE 'UTC' reinterprets the stored UTC wall-clock
-- correctly). Guarded so re-running on tztz columns is a clean no-op.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'memories' AND column_name = 'created_at')
     = 'timestamp without time zone' THEN
    ALTER TABLE memories ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE memories ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
  END IF;
END $$;

-- updated_at must bump on every UPDATE or it is a dead default (live had no
-- trigger). CREATE OR REPLACE + DROP/CREATE = idempotent.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS update_memories_updated_at ON memories;
CREATE TRIGGER update_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── eviction tombstone ───────────────────────────────────────────────
-- Recoverable: eviction sets evicted_at; recovery is UPDATE ... SET evicted_at
-- = NULL. The read-path filter that makes it MEAN anything is a separate,
-- exhaustive sweep across the read functions/adapters (parallel-paths).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS evicted_at TIMESTAMPTZ;
-- Indexes the live set; useful both for "is this live" filters and for finding
-- long-tombstoned rows (the Phase-B erase-pass gate).
CREATE INDEX IF NOT EXISTS idx_memories_live ON memories(created_at DESC) WHERE evicted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_evicted_at ON memories(evicted_at) WHERE evicted_at IS NOT NULL;

-- ── miss-telemetry substrate ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_events (
  search_id    TEXT PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  query_text   TEXT,
  query_hash   TEXT,
  project_id   TEXT,
  session_id   TEXT,            -- typed episode handle; matches memories.session_id
  match_count  INT,
  rrf_k        INT,
  pool         INT,
  returned_ids TEXT[]
);
CREATE INDEX IF NOT EXISTS idx_search_events_ts      ON search_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_search_events_session ON search_events(session_id);
CREATE INDEX IF NOT EXISTS idx_search_events_qhash   ON search_events(query_hash);

-- One row per fused candidate. No FK to memories on purpose: confirmed-miss
-- reconstruction must survive a later hard-erase of the memory, and pre-eviction
-- capture references tombstoned-but-present rows.
CREATE TABLE IF NOT EXISTS search_candidates (
  search_id  TEXT NOT NULL REFERENCES search_events(search_id) ON DELETE CASCADE,
  memory_id  TEXT NOT NULL,
  fts_rank   INT,
  vec_rank   INT,
  trgm_rank  INT,
  rrf        DOUBLE PRECISION,
  final_rank INT,
  returned   BOOLEAN,
  PRIMARY KEY (search_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_search_candidates_memory ON search_candidates(memory_id);

-- search_hybrid_candidates(): the boundary capture. Same params/fts/vec/trgm/
-- fused CTEs as search_hybrid() (001) but returns ids + per-leg ranks + rrf +
-- final_rank only -- NO content join (joins memories for created_at tiebreak
-- ONLY, to match search_hybrid's order exactly), NO top-k LIMIT. Telemetry sees
-- EVERYTHING: no evicted_at filter here (deliberate -- the one place the sweep
-- does not apply, so an eviction-caused miss is visible to the guard).
DROP FUNCTION IF EXISTS search_hybrid_candidates(text, vector, int, text, int);
CREATE OR REPLACE FUNCTION search_hybrid_candidates(
  q_text  text,
  q_vec   vector(768),
  rrf_k   int  DEFAULT 60,
  proj_id text DEFAULT NULL,
  pool    int  DEFAULT 100
)
RETURNS TABLE (
  memory_id  text,
  fts_rank   int,
  vec_rank   int,
  trgm_rank  int,
  rrf        double precision,
  final_rank int
)
LANGUAGE sql STABLE
SET pg_trgm.word_similarity_threshold = 0.3
AS $$
WITH params AS (
  SELECT replace(plainto_tsquery('simple', q_text)::text, ' & ', ' | ')::tsquery AS tsq
),
fts AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY ts_rank_cd(m.content_fts, p.tsq) DESC, m.created_at DESC)::int AS rank
  FROM memories m, params p
  WHERE numnode(p.tsq) > 0
    AND m.content_fts @@ p.tsq
    AND (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY ts_rank_cd(m.content_fts, p.tsq) DESC
  LIMIT pool
),
vec AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY m.embedding <=> q_vec)::int AS rank
  FROM memories m
  WHERE m.embedding IS NOT NULL
    AND (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY m.embedding <=> q_vec
  LIMIT pool
),
trgm AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY word_similarity(q_text, m.content) DESC)::int AS rank
  FROM memories m
  WHERE q_text <% m.content
    AND (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY word_similarity(q_text, m.content) DESC
  LIMIT pool
),
fused AS (
  SELECT COALESCE(fts.memory_id, vec.memory_id, trgm.memory_id) AS memory_id,
         fts.rank  AS fts_rank,
         vec.rank  AS vec_rank,
         trgm.rank AS trgm_rank,
         COALESCE(1.0/(rrf_k + fts.rank),  0) +
         COALESCE(1.0/(rrf_k + vec.rank),  0) +
         COALESCE(1.0/(rrf_k + trgm.rank), 0) AS rrf
  FROM fts
  FULL OUTER JOIN vec  ON vec.memory_id  = fts.memory_id
  FULL OUTER JOIN trgm ON trgm.memory_id = COALESCE(fts.memory_id, vec.memory_id)
)
SELECT f.memory_id, f.fts_rank, f.vec_rank, f.trgm_rank, f.rrf,
       row_number() OVER (ORDER BY f.rrf DESC, m.created_at DESC, f.memory_id)::int AS final_rank
FROM fused f
JOIN memories m ON m.memory_id = f.memory_id
ORDER BY final_rank;
$$;
