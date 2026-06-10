-- Author: PB and Claude
-- Date: 2026-06-09
-- License: (c) HRDAG, 2026, GPL-2 or newer
--
-- claude-mem/src/db/migrations/003_loop_instrumentation_tombstone_reason.sql
--
-- Workstreams A+B substrate (neg-6b0a3bf5, ratified 2026-06-09). Additive +
-- idempotent, two pieces:
--
--   * loop instrumentation : search_events grows the Stop-RAG read-loop
--     columns. Each loop iteration is its OWN /search call = own row;
--     loop_id groups a loop's rows, loop_iteration orders them, so the
--     ordered-history property holds by construction (no arrays, no session
--     reconstruction). sufficiency_verdict is the reader's judgment posted
--     via POST /search-verdict; loop_outcome is written once, at loop stop,
--     on the final iteration's row (production terminal label -- offline
--     hit/miss joins from returned_ids instead, never conflate the two).
--     Verdict TEXT is deliberately unconstrained here: the orchestrator
--     (cc-dots L1) validates its enum verb-side; the engine stores.
--
--   * tombstone reason     : memories grows evicted_by + evict_reason next
--     to 002's evicted_at. evict_reason is free TEXT (the
--     superseded-by/contradicted-by-disk/stale-as-of enum is validated by
--     the forget verb, not enforced here). Recovery surface is
--     GET /memory/:memory_id, which is NOT evicted-filtered.

-- ── search_events: read-loop instrumentation ─────────────────────────
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS sufficiency_verdict TEXT;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS loop_iteration      INT;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS loop_id             TEXT;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS loop_outcome        TEXT;
-- Reconstruct a loop's ordered history in one index scan.
CREATE INDEX IF NOT EXISTS idx_search_events_loop
    ON search_events(loop_id, loop_iteration) WHERE loop_id IS NOT NULL;

-- ── memories: tombstone provenance ───────────────────────────────────
ALTER TABLE memories ADD COLUMN IF NOT EXISTS evicted_by   TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS evict_reason TEXT;
