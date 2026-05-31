<!--
Author: PB and Claude
Date: 2026-05-31
License: (c) HRDAG, 2026, GPL-2 or newer

---
claude-mem/docs/harvester-plan-20260531.md
-->

# Doc Harvester — plan (v1)

**Status:** DRAFT for review. Decisions in §4 are unresolved and gate implementation. Nothing is built yet.

## 1. Goal

An autonomous agent — backed by skills and deterministic scripts — that walks the likely document locations on `{porky, scott, ben, chll}`, finds docs (incident reports / post-mortems above all, but generously: more is better than less), distills each into structured memories, and harvests them into claude-mem's DB on snowball. The agent runs the loop; the human spot-checks output, not each doc.

The failure we are correcting: the prior `extract-lessons-learned/` workflow was human-in-the-loop one-doc-at-a-time, which exhausted PB and stalled — and it discarded the human's accept/reject judgment instead of persisting it, so the effort never compounded and the negative examples evaporated.

## 2. What we established (the structure this plan is built on)

- **Sources are per-host, not uniform.** Every host has `~/docs` (always present) and `~/projects/**` repos (find their docs). porky additionally has the Obsidian vault `~/notes`. So the walker needs a declarative **per-host source manifest**, not one fixed path list.
- **Corpus, measured on porky:** `~/docs` — incident reports (`incidents/`, `incident-2026-05-14-*`), 71 `lessons-learned/` entries, runbooks, model-audits, specs. `~/notes` — 359 md / 27M, of which ~200 are ≥1KB and the `lessons/` folder (86 files) is the prize; ~250 dated daily notes are thin/mixed. scott's `~/docs/lessons-learned` is empty — hosts genuinely differ.
- **A signal floor is required even under "more is better."** Empty (0-byte) and sub-100-byte stubs, and thin daily journals, are embedding calls and clutter, not signal. Daily-journal notes (a day mixes unrelated fragments) need different handling from coherent topical docs.
- **Prior art to reuse, not reinvent:** `extract-lessons-learned/CLAUDE.md` already encodes a solid distillation method — a 5-type taxonomy (Decision / Pattern / Mistake / Recommendation / Technical-Fact), reading heuristics, a GOOD-vs-BAD example pair, and a quality bar. We keep the taxonomy and standards.
- **But it targets a dying API.** That framework calls MCP `store-dev-memory` with rich metadata + `search-enhanced`. The MCP surface is being retired (`docs/TODO-retire-mcp.md`). The live contract is REST `POST /store` accepting only `{content, tags, source_key}` (`src/index-http.ts:98`); `content_type` is auto-detected server-side. The taxonomy must be refit onto this.
- **Dedup infrastructure now exists and must be used.** `source_key` UPSERT (Track 2b) and hybrid lexical+vector `/search` (RRF, `3a7e161`) are live. The harvester does dedup-at-write: hybrid-search before store, upsert on near-duplicate, insert on novel — so the store stops accreting near-dupes.
- **Positives survived, negatives did not.** The old distilled memories are intact in the DB (verified: the `fsck-on-carved-volumes` decision et al.). The rejections were never persisted. The durable fix below makes the labeled set a byproduct of harvesting.

## 3. Architecture — agent + skills + scripts

Deterministic work in scripts; judgment in the agent/skills; provenance and idempotency in a ledger.

1. **Source manifest** (`harvest/sources.toml`) — declarative per-host roots, include/exclude globs, and signal-floor thresholds. Example: all hosts → `~/docs/**`, `~/projects/*/{README*,docs/**,*.md}`; porky also → `~/notes/{lessons/**, **/*.md}` minus `.obsidian/`, `.trash/`, sub-100-byte files.
2. **Enumerator script** (`harvest/enumerate.sh`, runs per host — locally or over SSH) — walks the manifest, applies signal floor + excludes, emits a JSON manifest: `{host, path, size, sha256, mtime}` per candidate. No model. Deterministic and re-runnable.
3. **Processed-marker + harvest ledger** — two mechanisms, two jobs.
   - **In-file marker (primary "have we seen this" check).** On successful harvest the agent appends an EOF HTML comment to the source file: `<!-- claude-mem-harvested: <ISO8601> sha256:<hash-of-content-excluding-this-marker> memories:<n> -->`. Invisible in rendered markdown/Obsidian, travels with the file, survives DB rebuilds, and sits "at the bottom" per PB's convention. The enumerator skips a file iff the marker is present **and** the recomputed content-hash (with the marker line stripped) matches — so an *edited* doc loses the match and is re-harvested. No marker found applied anywhere in the corpus today (the old extraction-log step was designed but never written to files); we define the format here and apply it going forward.
   - **Caveat — repo'd sources.** Appending a marker to a doc inside a `~/projects/*` git repo dirties that repo. For repo'd sources the seen-check falls back to the DB/ledger (by `source_key` / source path), not an in-file marker. In-file markers are for the loose-file sources (`~/docs`, `~/notes`).
   - **Ledger (provenance + labeled set).** Records, per `(host, path, content-sha256)`: disposition (`harvested` / `skipped` / `rejected` / `superseded`), the `source_key`s / `memory_id`s produced, timestamp, distiller version + confidence. It is the supersede index for idempotent re-harvest (see §4-C) **and** accumulates the labeled accept/reject set we lost last time.
4. **Distiller skill** — given one doc, emit candidate memories per the 5-type taxonomy refit to REST; for each: hybrid `/search` for near-dups → decide insert / upsert / skip → `POST /store` with a stable `source_key` + tags (taxonomy type carried as a `type:<kind>` tag pending the §4-B decision).
5. **Harvester agent** — orchestrates: load manifest → for each unprocessed/changed doc → distill → dedup-store → write ledger disposition. Autonomous across a batch; surfaces a batch summary + the low-confidence queue for spot-check, not per-doc prompts.
6. **Review / labeling skill** — PB spot-checks a sample and the low-confidence queue; every accept and reject writes to the ledger as labeled data.

## 4. Decisions

**Resolved 2026-05-31 (PB):** A accepted (central agent, SSH-read remote). B accepted (v1 fold type+rationale into `content`+tags, carry `type:<kind>` tag, `/store` `type` field as fast-follow). C accepted — concrete rule below. D resolved — see below. E accepted (conservative dedup, prefer insert when unsure). F accepted (confidence-gated + sampled, all logged).

- **A. Execution model.** Central agent on porky that SSH-reads remote files and distills locally, vs. a runner on each host. Lean: central agent; the enumerator runs remotely over SSH to emit a manifest, the central agent pulls and distills the selected files. (Matches what we already do; one place to run the model.)
- **B. How the taxonomy lands in `/store`.** v1: fold type + rationale/context into well-structured `content` prose plus tags (no API change), vs. extend `/store` + schema to accept an explicit `type` (and maybe light metadata). Lean: v1 fold-in, but carry `type:<kind>` as a tag from day one, and treat a minimal `/store` `type` field as a fast-follow once the taxonomy proves out.
- **C. `source_key` derivation — RESOLVED: the document is the unit of idempotency.** `source_key = <host>:<relpath-from-home>::<ordinal>` (ordinal only disambiguates the N memories from one doc; it need not be stable across re-distills). Re-harvest logic keys off the document, not the individual memory: marker content-hash unchanged → skip the doc entirely; changed or absent → look up all `source_key`s with prefix `<host>:<relpath>::` in the ledger, mark them `superseded`, re-distill, and insert the fresh set. This sidesteps per-memory key stability (a re-distill that reorders or re-counts memories can't orphan or duplicate) at the cost of replacing a doc's whole memory set on any change — acceptable, and the ledger keeps the supersede trail.
- **D. Distiller model + cost — RESOLVED: one capable model (Sonnet) for everything in v1; no pre-classification.** "Routine" can't be predicted up front, and a wrong guess sends a hard incident report to a weak model. Cost isn't binding at this scale (~200 substantive porky docs × a few-K tokens ≈ ~1M input tokens, a few dollars once). Defer tiering. If cost bites at cross-host scale, escalation is driven by the **same confidence signal F uses** — cheap-first, escalate when the model self-reports low confidence or the output is thin — never a pre-classifier. Confidence is logged per doc regardless (it also drives F).
- **E. Dedup aggressiveness.** Similarity threshold for upsert-vs-insert. Lean: conservative — prefer insert when unsure, let the Curator merge later; the old "better slight dups than miss" instinct, now bounded by `source_key`.
- **F. Human checkpoint cadence.** Confidence-gated + sampled (auto-accept high-confidence, queue low-confidence, sample the rest) vs. full batch review. Lean: confidence-gated + sampled, everything logged either way.

## 5. Phasing (each phase has a verifiable done-condition)

- **Phase 0 — Refit + decisions.** Resolve §4 A–F. Port the `extract-lessons-learned` taxonomy + quality bar to a REST-targeted distiller spec. *Done when:* the distiller spec and `source_key` rule are written and A–F are answered in this doc.
- **Phase 1 — porky vertical slice.** Enumerator + ledger + distiller skill + dedup-store, run on the two high-value, bounded folders: `~/docs/lessons-learned` and `~/notes/lessons` (86 files). *Done when:* running the harvester on those folders stores deduped memories retrievable via `/search`, the ledger records a disposition for every file, and a spot-check sample is reviewed — producing the first labeled accept/reject rows.
- **Phase 2 — full porky + idempotent resume.** Extend to all of `~/docs`, `~/projects/*` repo docs, and full `~/notes` with the signal floor. *Done when:* a second run re-processes zero unchanged docs (ledger-driven) and only picks up edits/new files.
- **Phase 3 — cross-host.** Per-host enumeration over SSH for scott / ben / chll; central distillation. *Done when:* each host's `~/docs` + `~/projects` are harvested with host-tagged provenance and no cross-host `source_key` collisions.
- **Phase 4 — labeling / eval loop.** The accumulated accept/reject ledger becomes a quality eval set; optionally feed the Curator (`analyze-memory-quality`). *Done when:* the labeled set is queryable and a baseline distiller-quality metric is recorded.

## 6. Non-goals / deferred

- Not the session-capture Stop hook (`mem-capture.sh`) — that is a separate concern; this is batch document ingestion.
- Not the degradation/failure-signal half (old jobs 2 & 3 / Track 3B).
- No MCP-surface work — REST only.
- No schema migration in v1 unless §4-B chooses the `/store` `type` extension.
