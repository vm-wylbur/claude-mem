-- Author: PB and Claude
-- Date: 2026-06-11
-- License: (c) HRDAG, 2026, GPL-2 or newer
--
-- claude-mem/src/db/migrations/006_canonical_id_checks.sql
--
-- The durable half of the id-cruft cleanup (#22 + the decimal-era retirement,
-- PB 2026-06-11: "we have had serious problems in this project with
-- misunderstood ids that were badly typed in the Postgres backend"). The ids
-- are TEXT, and over the project's history that TEXT carried five different
-- shapes (decimal BigInt, unpadded hex, padded hex, sha256, sequential seed).
-- Cleanup scripts canonicalized the data; these CHECK constraints make the
-- BACKEND enforce the canonical shape so no future code path — app bug,
-- migration script, manual psql — can reintroduce a malformed id.
--
-- Canonical shapes:
--   memories.memory_id / tags.tag_id / projects.project_id : 16-char
--     lowercase zero-padded hex (xxHash64; seeds are sequential-in-hex).
--   lessons_learned_docs.doc_id : 64-char lowercase hex (sha256 of the
--     host-qualified filepath, per the harvester contract).
--
-- Deliberately UNCONSTRAINED: search_events.search_id (client-supplied
-- correlation handle, free TEXT by contract) and evict_reason/verdict TEXT
-- (verb-side validation, ratified).
--
-- Idempotent via the IF NOT EXISTS guards. Prereq: data already canonical
-- (verified zero non-conforming rows on live before this ships; a violation
-- here on a future DB means the data needs the 005/cleanup pass first --
-- that is the constraint doing its job).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_memory_id_canonical') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_memory_id_canonical
      CHECK (memory_id ~ '^[0-9a-f]{16}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_tag_id_canonical') THEN
    ALTER TABLE tags ADD CONSTRAINT tags_tag_id_canonical
      CHECK (tag_id ~ '^[0-9a-f]{16}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_id_canonical') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_project_id_canonical
      CHECK (project_id ~ '^[0-9a-f]{16}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'docs_doc_id_canonical') THEN
    ALTER TABLE lessons_learned_docs ADD CONSTRAINT docs_doc_id_canonical
      CHECK (doc_id ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
