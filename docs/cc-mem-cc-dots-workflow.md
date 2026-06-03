<!--
Author: PB and Claude
Date: 2026-06-03
License: (c) HRDAG, 2026, GPL-2 or newer

---
docs/cc-mem-cc-dots-workflow.md

Converged via claude-negotiate session neg-305c49e5 (2026-06-03), which
re-cut the cc-mem <-> cc-dots boundary. Builds on / extends neg-f4b47b06
(the scott serving <-> eval/distiller API contract, which stays in force).

Single steward: cc-mem. Amendable only by a future claude-negotiate session
(a version bump rides a tracked GH issue per R4 below).

v1 (2026-06-03): initial convergence — verifiability principle, conformance-suite
mechanism, two invariants, contract-surfaces table, read-path #5 commitment.
-->

# cc-mem ↔ cc-dots workflow (v1)

cc-mem is the memory-layer **platform** (the REST service, Postgres + pgvector, embeddings, search/retrieval, scott serving + kj-apis deploy). cc-dots builds the **products** on it (the harvester: distiller, eval, model selection, keep/skip gate). This document is the boundary between them for the harvest write/read path. It re-cuts neg-f4b47b06, which stays in force for the serving ↔ eval API; this doc governs only the write/read path.

## Governing principle

**Ownership follows verifiability:** each party owns what it can independently build, run, and check.

## Allocation

- **cc-mem** — what runs on snowball and is checkable only there: the TS REST service (`src/**` — routing, auth/secret middleware), the DB schema + migrations, the connection pool, the ollama embedding pipeline, search/retrieval, the `doc_hash` derivation primitive, scott serving + kj-apis deploy.
- **cc-dots** — what's checkable over HTTP from porky: the endpoint contract (request/response schemas for doc-upsert, store-with-`source_doc_id`, append-`extraction_decisions`, and the two read endpoints below); the invariants as executable assertions; the conformance suite that exercises them; and the harvester itself (`harvest/*.py` — distiller, eval, model selection, keep/skip gate).

## Mechanism — conformance suite, not a referee

cc-dots specifies behavior as a schema + a conformance test; cc-mem implements until the suite is green. Acceptance is the suite passing — not a merge-referee and not a request queue. New behavior cc-dots needs enters as a new (red) assertion, not prose. This is why the worktree/merger workaround is not carried forward: it was scoped to one problem, and an executable gate replaces the referee it stood in for.

- **[R3]** The suite pins **behavior** (black-box over HTTP). cc-mem stays free to refactor `src/**` internals as long as the suite stays green.
- **[R2]** The suite is authored + maintained by cc-dots **in cc-dots's slice**, exercised over HTTP. It is never committed into the claude-mem repo — otherwise two agents write one repo again and the referee comes back.
- **[T3]** cc-dots publishes the suite as a **versioned, pinned artifact**. cc-mem runs the pinned version as its pre-deploy gate against a local service instance — no live cross-host reach into porky (which would couple cc-mem's deploy to porky uptime and let the gated contract version drift silently). A version bump rides a tracked GH issue. Registry/location is an implementation detail; versioning + pin + no-live-cross-host-reach is the contract.
- **[R4]** A new red assertion's **trigger** is a GH issue in the owning agent's repo (a request to cc-mem → an issue in claude-mem; a request to cc-dots → an issue in pb-dotfiles), so the implementing agent carries a tracked obligation rather than a red test on a machine it isn't watching.
- Suite-authoring note (advisory, cc-dots's domain): the fixed corpus should include a doc where strip/normalize ≠ raw, so invariant #2's equality assertion exercises the byte-derivation gotcha instead of passing vacuously.

## Invariants the suite pins

1. **`/store` embeds before insert.** Direct SQL inserts leave memories unembedded and invisible to vector search. Assertion: a stored memory is retrievable by vector query.
2. **Marker `doc_hash` == service `doc_hash`,** computed with **sha256** over the **exact ingested content bytes** — which bytes get hashed is part of the derivation (sha256 of a stripped/normalized body does *not* equal `doc_hash`). cc-mem's primitive is the single source of truth; the suite asserts equality on a fixed corpus.
   - Code reality (verified both sides): `doc_hash` + `doc_id` are sha256, not blake3. The hash fn in `src/tools/sync-docs.ts` always computed `createHash('sha256')` despite a `blake3Hash` name (renamed to `sha256Hash`, commit db10085); cc-dots's `markerlib.py` is locked to sha256 (commit 6981a63).
   - Plan Decision C amended blake3 → sha256 (reconcile-to-shipped-reality, not a redesign).

## Read path (resolves claude-mem #5)

`eval.py` doc-load and the `distill.py` backlog query are the only client paths still on `ssh snowball psql`. cc-dots authors the red read-endpoint conformance test; two endpoints make it green:

1. doc fetch by id/hash (for `eval.py`)
2. the un-distilled-backlog query — rows in `lessons_learned_docs` with no matching `extraction_decisions.doc_id`

"Green" = the harvester runs with **zero snowball SSH**. cc-mem platform obligation: the auth token is scoped to harvester/memory ops, not a write-anything god-key. (Handoff: pb-dotfiles#3.)

## Contract surfaces

Touching one of these requires a +1 from the named coordinator before merge.

| surface | author | coordinator |
|---|---|---|
| rerank fusion / golden-set | cc-mem | cc-dots +1 |
| harvester REST secret scope | cc-mem | cc-dots +1 |
| `doc_hash` derivation (algorithm + canonical fn + input-byte derivation) | cc-mem | cc-dots +1 |
| endpoint schema + invariants (conformance suite) | cc-dots | cc-mem +1 (on schema/migration touch) |

## Tracked deferral (visible, not silent)

Server-side recompute/verify of `doc_hash` on the write path is deferred — tracked as **claude-mem #6**. Rationale: the filepath-keyed upsert stores a client-supplied `doc_hash` unverified, so a stale/buggy client can poison dedup lineage; the fixed-corpus equality assertion cannot catch a runtime wrong-hash. Deferred, not "optional."

## Out of scope / kept

- The harness/skills "third domain" → deferred to PB; does not block this boundary.
- neg-f4b47b06 (serving ↔ eval API) stays in force, untouched.

## Implementation status (2026-06-03)

| item | owner | status |
|---|---|---|
| `doc_hash` cleanup (rename fn, fix schema comments, remove dead `schema-postgresql.sql`) | cc-mem | **done** — db10085 |
| server-side `doc_hash`-verify deferral, tracked | cc-mem | **filed** — claude-mem #6 |
| read-path endpoints + scoped secret | cc-mem (impl) / cc-dots (red test + secret-scope +1) | **handed off** — pb-dotfiles#3; impl pending cc-dots's pinned read-test; tracks claude-mem #5 |
| this workflow doc | cc-mem | **done** (v1) |

Adjacent issue surfaced during the cleanup (not part of this boundary, but cc-mem platform domain): **claude-mem #7** — fresh-DB bootstrap doesn't match live (no migration runner → `search_hybrid` missing; `memory_id` SERIAL/TEXT drift).
