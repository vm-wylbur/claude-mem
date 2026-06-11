-- Author: PB and Claude
-- Date: 2026-06-11
-- License: (c) HRDAG, 2026, GPL-2 or newer
--
-- claude-mem/src/db/migrations/005_pad_hash_ids.sql
--
-- Issue #22: xxHash64 ids were generated with toString(16) and NO padding,
-- so a hash with leading zero nibbles stores as a <16-char id — while
-- responses echo the 16-char padded display form. The echoed id then 404s
-- on /memory/:id, /evict, /unevict for ~1/16 of memories (and the same
-- latent defect exists for tag ids). This migration canonicalizes ALL
-- stored ids to 16-char zero-padded hex; the paired code change pads at
-- generation, and MUST deploy in the same restart (old code computing
-- unpadded hashes against padded rows would miss dedup/upsert matches).
--
-- COLLISION SAFETY: toString(16) never emits leading zeros, so every
-- existing 16-char id starts with a non-zero nibble; every lpad()ed short
-- id starts with '0'. The two sets are disjoint — no UPDATE can collide.
--
-- FK handling: the referencing constraints are NOT deferrable, so neither
-- parent-first nor child-first update order passes the immediate check.
-- Drop + re-add (identical to the base-schema definitions) around the
-- updates; the whole file runs in one transaction under the runner /
-- surgical psql -1, so no window where the constraints are absent is
-- visible to other transactions.
--
-- Idempotent: all updates are WHERE length(...) < 16 (no-ops on a clean
-- DB); DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT re-creates the same
-- constraints. search_candidates.memory_id and search_events.returned_ids
-- have no FK to memories (by design — telemetry survives erasure) but are
-- padded for join consistency.

ALTER TABLE memory_tags DROP CONSTRAINT IF EXISTS memory_tags_memory_id_fkey;
ALTER TABLE memory_tags DROP CONSTRAINT IF EXISTS memory_tags_tag_id_fkey;
ALTER TABLE memory_relationships DROP CONSTRAINT IF EXISTS memory_relationships_source_memory_id_fkey;
ALTER TABLE memory_relationships DROP CONSTRAINT IF EXISTS memory_relationships_target_memory_id_fkey;

UPDATE memories            SET memory_id        = lpad(memory_id, 16, '0')        WHERE length(memory_id) < 16;
UPDATE memory_tags         SET memory_id        = lpad(memory_id, 16, '0')        WHERE length(memory_id) < 16;
UPDATE tags                SET tag_id           = lpad(tag_id, 16, '0')           WHERE length(tag_id) < 16;
UPDATE memory_tags         SET tag_id           = lpad(tag_id, 16, '0')           WHERE length(tag_id) < 16;
UPDATE memory_relationships SET source_memory_id = lpad(source_memory_id, 16, '0') WHERE length(source_memory_id) < 16;
UPDATE memory_relationships SET target_memory_id = lpad(target_memory_id, 16, '0') WHERE length(target_memory_id) < 16;
UPDATE extraction_decisions SET stored_memory_id = lpad(stored_memory_id, 16, '0')
  WHERE stored_memory_id IS NOT NULL AND length(stored_memory_id) < 16;
UPDATE search_candidates   SET memory_id        = lpad(memory_id, 16, '0')        WHERE length(memory_id) < 16;
UPDATE search_events       SET returned_ids =
    (SELECT coalesce(array_agg(lpad(x, 16, '0') ORDER BY ord), '{}')
     FROM unnest(returned_ids) WITH ORDINALITY AS t(x, ord))
  WHERE returned_ids IS NOT NULL
    AND EXISTS (SELECT 1 FROM unnest(returned_ids) x WHERE length(x) < 16);

ALTER TABLE memory_tags ADD CONSTRAINT memory_tags_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;
ALTER TABLE memory_tags ADD CONSTRAINT memory_tags_tag_id_fkey
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE;
ALTER TABLE memory_relationships ADD CONSTRAINT memory_relationships_source_memory_id_fkey
  FOREIGN KEY (source_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;
ALTER TABLE memory_relationships ADD CONSTRAINT memory_relationships_target_memory_id_fkey
  FOREIGN KEY (target_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;
