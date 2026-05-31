<!--
Author: PB and cc-dots 🧷
Date: 2026-05-31
License: (c) HRDAG, 2026, GPL-2 or newer

---
claude-mem/docs/harvester-plan-20260531.md
-->

# Doc Harvester — plan (v2: revive, don't rebuild)

**Status:** DRAFT for review. Rewritten after discovering that the two-tier harvest system already exists in the live `claude_mem` DB and ran ~Nov 2025–Jan 2026 before going fallow. This is now a revival + automation plan, not a greenfield build. Decisions in §5 gate implementation.

## 1. Goal

Revive the existing claude-mem document-harvest pipeline so it runs autonomously across `{porky, scott, ben, chll}`: capture every doc-like `.md` into the raw-docs tier, distill the worthwhile ones into memory records, and record every accept/edit/reject as labeled data — without the manual, one-doc-at-a-time review loop that exhausted PB and stalled it.

The hard part was never plumbing or storage (both exist). It is **selective distillation**: turning a doc into a few high-signal memories and *rejecting* the rest, at scale, with judgment good enough that PB only spot-checks.

## 1.1 North star & scope

**North star:** the labeled set (`extraction_decisions`) is the *product*, not a byproduct. It both seeds the distiller (few-shot) and grades it (eval), so the distiller converges on PB's taste and supervision drops over time. This is the "training data" goal that motivated the original effort; the old approach generated that data and then discarded its leverage. Every phase should grow and exploit the labeled set, not just move docs.

**In scope (v2):** the whole documentary record — `~/docs`, `~/projects/*` repo docs, the Obsidian vault — across porky/scott/ben/chll; an autonomous distiller (human spot-checks only); a standing, idempotent, change-aware, schedulable pipeline that doesn't re-go-fallow when attention moves.

**Horizon (named, not committed):** generalizing past markdown to READMEs/specs/PR-issue-commit text (`git_commits` already exists); converging the doc harvester with the session-capture path onto one shared provenance + dedup + gate. A different project — flagged to bound scope, not to build now.

Note: the live tier-1 table is `lessons_learned_docs`, but the scope is now *all* docs; the concept widened without renaming the live table.

## 2. What already exists (verified live on snowball, 2026-05-31)

The design we sketched in v1 is, table-for-table, what is already running:

- **`lessons_learned_docs` — 304 rows.** Tier 1, the raw-docs archive: `doc_id` (blake3 of filepath), `filename`, `filepath UNIQUE`, full `content`, `file_mtime`, `doc_hash` (blake3 of content, for change detection), `metadata` JSONB. Coverage: 71 from porky `/Users/pball`, 233 from Linux hosts. Populated 2025-11-18 → 2026-01-24, then fallow.
- **`memories`** — tier 2, distilled records, with a defined `source_doc_id` FK back to `lessons_learned_docs`.
- **`extraction_decisions` — 115 rows.** The labeled set we thought was lost: `action ∈ {approved(84), edited(20), skipped(11)}`, `insight_title`, `insight_content`, `edited_content`, `skip_reason`, `stored_memory_id`, FK to the doc. This is the accept/reject judgment, persisted.
- **`git_commits` — 182 rows.** Separate git-integration feature; out of scope here.

**The fallow gap, quantified:** only **21 of 304 docs** ever produced decisions. **283 docs are raw-only** — captured but never distilled. That backlog is the bulk of the work.

## 3. The gate already exists as labeled data

The 11 `skipped` reasons are a ready-made rejection taxonomy — exactly the specificity/novelty/accuracy gate, in PB's own words:

- **Inaccurate / dangerous:** "incorrect conclusion, erroneous and dangerous shortcut"; "accuracy uncertain — claim … may not be true".
- **Too generic:** "generic advice without specific implementation or context".
- **Too project-specific:** "too specific to this project, not a reusable lesson".
- **Failed approach, not a solution:** "proposed approach that failed to boot"; "troubleshooting steps for approach that ultimately failed".
- **Human halt:** "user stopped extraction" (the exhaustion, literally recorded).

The 20 `edited` rows are gold: each is PB's hand-correction of an AI draft (orig → edited), and they mostly *grew* — adding context, caveats, and specificity. The distiller should be **few-shot-seeded from this table** (approved as positives, edited as orig→better pairs, skipped+reason as negatives), not handed freshly-invented criteria.

## 4. Gap analysis — what's missing or broken

1. **Distiller is manual.** The review loop was human-driven per doc. Automating it (seeded by §3) is the core deliverable.
2. **Write path can't drive this schema over REST.** The old run used MCP `store-dev-memory`, which set `source_doc_id` and wrote `extraction_decisions`. REST `/store` accepts only `{content, tags, source_key}` — it cannot populate the doc link or the decision log, and the MCP surface is being retired. Reviving on REST needs the service to expose doc-upsert + decision-logging + `source_doc_id`. **Must go through the service, not direct SQL** — the service owns embedding generation (ollama); raw SQL inserts would leave memories unembedded and invisible to vector search.
3. **Same content at multiple paths.** `LVM1-ReiserFS-Extraction-Guide.md` is in `lessons_learned_docs` three times (two Linux paths + porky). `filepath` is UNIQUE, so N paths → N rows → N× distillation → duplicate memories. Dedup must key on **content (`doc_hash`)**, not path. Our v1 `source_key = host:relpath` has the same path-duplication flaw.
4. **`memories.source_doc_id` is unpopulated (0 rows).** Provenance is defined but never filled; today it lives only via `extraction_decisions.stored_memory_id`. Revival should populate the FK directly.
5. **Schema drift.** `lessons_learned_docs`, `extraction_decisions`, `git_commits` exist live but are absent from `src/db/postgres-schema.sql` (what `postgres-init.ts` loads). Re-running init would not recreate them — a latent data-loss footgun. Capture them into the committed schema.
6. **Cross-host gap.** 233 Linux + 71 porky docs are in; porky's full `~/docs` + the `~/notes` Obsidian vault are not; scott/ben/chll need per-host walks.
7. **Marker vs `doc_hash`.** The DB already does content-hash change detection via `doc_hash`. The v1 in-file EOF marker is largely redundant for that. Keep the marker only as an optional host-local fast-skip hint; `doc_hash` (content) is the authoritative change/dedup key.

## 5. Decisions

- **A. Write path — extend the service's REST surface** (lean, not yet ratified). Add endpoints (or extend `/store`) to: upsert a `lessons_learned_docs` row, store a memory with `source_doc_id`, and append an `extraction_decisions` row. Rationale: REST is the sole supported client surface, and the service must generate embeddings. Direct SQL is rejected (skips embeddings).
- **B. Dedup unit — content hash (`doc_hash`).** One logical doc = one content hash, distilled once, regardless of how many paths/hosts hold it. Extra paths recorded as aliases in `metadata`, not as separate distillations.
- **C. Marker — keep it, visible on disk (PB).** Every harvested file carries the EOF marker so harvest state is legible in the file itself, not only in the DB. It coexists with `doc_hash`: the marker gives on-disk visibility + a cheap host-local skip; `doc_hash` is the DB's content-level dedup/change key across paths and hosts. **Unified on `blake3`** (matching the DB) so the two can never disagree — the v1 marker writes stdlib `sha256` and must move to the `blake3` package (or shell out to `b3sum`). Critical: the marker must hash the *same input bytes* the service uses to compute `doc_hash`, not merely the same algorithm — verify the service's `doc_hash` derivation (raw vs normalized content) when wiring this, or marker and `doc_hash` will diverge despite both being blake3.
- **D. Distiller model — one capable model (Sonnet) v1**, no pre-classification; escalation deferred to a confidence signal. (Carried from v1; cost is not binding at ~283 docs.)
- **E. Backlog scope — distill the 283 raw-only docs**; leave the 21 already-decided as-is for now (optionally re-run later for consistency).
- **F. Doc-type-conditioned distillation** — incident/post-mortem vs how-to guide vs daily note get different prompts and gates (the v1 guide-vs-incident finding).
- **G. Human checkpoint — confidence-gated + sampled**, every decision written to `extraction_decisions` (so the labeled set keeps growing). (Carried from v1.)

## 6. Phasing

- **Phase 0 — reconcile & clean up.**
  - Purge the orphaned `harvest-v1` memories (5) and revert the marker written to `~/docs/lessons-learned/LVM1-ReiserFS-Extraction-Guide.md` — that doc must go through the real pipeline.
  - Capture the three live tables into the committed schema (fix drift, §4.5).
  - Pull the full `extraction_decisions` set into a distiller seed/eval fixture.
  - *Done when:* committed schema matches the live DB, harvest-v1 side-effects are gone, and the seed fixture exists.
- **Phase 1 — revive the distiller on the real write path.** Service endpoints for doc-upsert + memory-with-`source_doc_id` + decision-log (§5-A). Distiller seeded by §3, run on a handful of the 283 backlog docs, writing proper `lessons_learned_docs` / `memories` / `extraction_decisions` rows. *Done when:* a backlog doc round-trips into all three tables with populated `source_doc_id`, and the distiller's keep/skip decisions agree with the existing labeled examples on a held-out check.
- **Phase 2 — content-hash dedup + full porky.** `doc_hash` dedup (§5-B); extend to all of porky `~/docs`, `~/projects/*` docs, and `~/notes` (incl. the 86-file `lessons/`). *Done when:* the same doc at multiple paths distills once, and porky coverage is complete.
- **Phase 3 — cross-host.** Per-host enumeration over SSH for scott/ben/chll into the service. *Done when:* each host's sources are harvested with host-aliased provenance and no content-duplicate memories.
- **Phase 4 — labeled set as eval.** Use `extraction_decisions` as a regression set for distiller quality. *Done when:* a baseline keep/skip agreement metric is recorded and tracked.

## 7. Non-goals

- Not the session-capture Stop hook (`mem-capture.sh`); this is batch document ingestion.
- Not `git_commits` / git integration.
- No MCP-surface work — REST/service only.
- Not re-distilling the 21 already-decided docs in v1 (deferred).

## 8. v1 scaffold disposition

The v1 worktree scripts (`harvest/enumerate.py`, `markerlib.py`, `mark.py`, `store.sh`, ledger) were built before the existing system was found. `enumerate.py` (walk + signal floor + doc-type input) is reusable; the standalone `store.sh` and the local `ledger.jsonl` are superseded by the service write-path (§5-A) and `extraction_decisions`. The in-file marker is demoted per §5-C. Treat the rest as throwaway.
