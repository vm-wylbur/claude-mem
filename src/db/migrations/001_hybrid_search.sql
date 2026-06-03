-- Author: PB and Claude
-- Date: 2026-05-31
-- License: (c) HRDAG, 2026, GPL-2 or newer
--
-- claude-mem/src/db/migrations/001_hybrid_search.sql
--
-- Phase 1 search upgrade: hybrid lexical + vector retrieval.
--
-- Adds a 'simple'-config FTS leg (no stemming, keeps identifiers like
-- sugihara / -r5 -n1 / ed25519-sk / commit hashes intact) and a pg_trgm
-- fuzzy leg, fused with the existing pgvector cosine leg via Reciprocal
-- Rank Fusion (RRF, k=60) inside search_hybrid().
--
-- Additive and reversible: new extension, column, indexes, function only.
-- The existing findSimilarMemories() vector path is untouched.
--
-- Measured lift on a 20-query golden set (eval/): recall@5 0.55 -> 1.00,
-- MRR 0.512 -> 0.792; exact-token recall 0.30 -> 1.00.
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS content_fts tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_memories_content_fts  ON memories USING gin (content_fts);
CREATE INDEX IF NOT EXISTS idx_memories_content_trgm ON memories USING gin (content gin_trgm_ops);

-- Three-leg RRF fusion. proj_id NULL = no project filter; pass the dev
-- project id to match the REST /search scope. proj_id and memories.project_id
-- are both TEXT (the app's 16-char hex project ids; see postgres-schema.sql), so
-- this is a plain text=text match -- no cast. recency_wt > 0 adds a gentle
-- 30-day-scale recency boost (default off so ranking is reproducible).
-- DROP first: CREATE OR REPLACE cannot alter the RETURNS TABLE column set.
DROP FUNCTION IF EXISTS search_hybrid(text, vector, int, int, text, int, double precision);
CREATE OR REPLACE FUNCTION search_hybrid(
  q_text       text,
  q_vec        vector(768),
  match_count  int  DEFAULT 10,
  rrf_k        int  DEFAULT 60,
  proj_id      text DEFAULT NULL,
  pool         int  DEFAULT 50,
  recency_wt   double precision DEFAULT 0.0
)
RETURNS TABLE (
  memory_id    text,
  project_id   text,
  content      text,
  content_type text,
  metadata     jsonb,
  created_at   timestamptz,
  similarity   double precision,
  score        double precision,
  fts_rank     int,
  vec_rank     int,
  trgm_rank    int
)
LANGUAGE sql STABLE
SET pg_trgm.word_similarity_threshold = 0.3
AS $$
WITH params AS (
  -- plainto_tsquery sanitizes punctuation & lowercases with no operator
  -- parsing (websearch_to_tsquery would read a leading '-' as NOT, which
  -- breaks flag-heavy queries like '-c' / '--no-detach'). Flip & -> | for
  -- OR/recall semantics; ts_rank_cd then rewards better term coverage.
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
SELECT m.memory_id, m.project_id, m.content, m.content_type, m.metadata, m.created_at,
       -- cosine similarity for the familiar field; 0 for a lexical-only hit
       -- with no embedding (ranking is by RRF score, not this value).
       CASE WHEN m.embedding IS NOT NULL
            THEN (1.0 - (m.embedding <=> q_vec))::double precision
            ELSE 0.0 END AS similarity,
       (f.rrf + recency_wt *
            (1.0 / (1.0 + extract(epoch FROM (now() - m.created_at))/2592000.0)))::double precision AS score,
       f.fts_rank, f.vec_rank, f.trgm_rank
FROM fused f
JOIN memories m ON m.memory_id = f.memory_id
ORDER BY score DESC, m.created_at DESC, m.memory_id  -- deterministic tiebreak
LIMIT match_count;
$$;
