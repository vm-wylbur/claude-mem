# claude-mem Search Augmentation — Implementation Plan

**Audience:** Claude Code (local), working in the `vm-wylbur/claude-mem` repo.
**Author context:** hand-off from a web-Claude research session (2026-05-31).
**Stack note:** the TypeScript MCP server is being **deprecated** in favor of CLI calls. This plan is therefore **Python end-to-end** — the CLI talks to Postgres directly via `psycopg`, and the reranker is an in-process import, not a sidecar.
**Goal:** evolve retrieval from vector-only to a three-layer system — hybrid lexical+vector recall, cross-encoder reranking, and temporal-validity awareness — without leaving the existing Postgres + pgvector + Ollama stack and without adopting an external memory framework (Mem0/Zep/Letta).

---

## What we're trying to improve

The system today retrieves by semantic vector similarity alone. That single mechanism has three concrete failure modes that this work targets, in priority order:

1. **Exact-token recall.** Vector search retrieves things that are *about* the query but routinely misses literal strings — hostnames (`kj`, `sugihara`), command flags (`-r5 -n1`), commit hashes, error text, package versions. These are the tokens an agent most often needs to match precisely, and they're exactly where dense embeddings are weakest. *Phase 1 (hybrid lexical + vector) addresses this.*
2. **Top-k precision.** Even with good recall, the right answer often sits at rank 7 instead of rank 1, so an agent reading only the top few results misses it. A cross-encoder that reads query and candidate together reorders far more accurately than first-stage retrieval. *Phase 2 (reranking) addresses this.*
3. **Stale-fact contamination.** The memory is full of facts that change over time — which model runs on which box, which OS version a host is on, which design decision superseded another. Flat storage returns the superseded fact and the current one with equal confidence, with no way to ask "what's true *now*" versus "what was true *then*." *Phase 3 (temporal validity) addresses this.*

Underneath all three: the agents searching this store should be able to find material **more than one way** — by meaning, by exact term, by partial/fuzzy match, and filtered by what's currently true — rather than being funneled through a single semantic channel. The measure of success is not a benchmark number but whether an agent reliably surfaces the right memory on the first query, including for the exact-identifier and "current state" lookups that dominate this corpus.

---

## 0. Orienting principles

1. **Fusion lives in SQL.** The merge of lexical + vector ranks belongs where the data is — one query, one transactional boundary. No app-side join of two round trips.
2. **One language now: Python.** With the MCP server gone, the CLI owns query embedding, the SQL call, and the rerank step in a single process. No localhost HTTP hop, no serialization boundary — the reranker is just an import.
3. **Borrow patterns, not systems.** We take Graphiti's bi-temporal *schema idea* (four timestamps per fact) and bolt it onto the existing `memories` / `memory_relationships` tables. We do **not** adopt Neo4j, Graphiti, or a graph DB.
4. **Each layer ships and is measured before the next.** Hybrid first, prove it, then rerank, then temporal. Don't stack unvalidated layers — a ranking bug hidden under a decay function is misery to debug.
5. **Additive and reversible.** Every change is a new column, new index, or new function. Existing search paths keep working until the new path is proven.

---

## Phase 1 — Hybrid retrieval (BM25 + vector + RRF + fuzzy)

**Why:** vector-only misses exact tokens — hostnames (`sugihara`, `kj`), flags (`-r5 -n1`), commit hashes, error strings, package versions. BM25 nails those; vectors nail paraphrase. RRF fuses them on *rank*, sidestepping the score-scale incompatibility that breaks weighted blends.

### 1a. Extension + index

Use **ParadeDB `pg_search`** (true Okapi BM25, self-host friendly, ships typo tolerance + scoring; the latency edge `pg_textsearch` has over it is irrelevant at single-user scale).

```sql
CREATE EXTENSION IF NOT EXISTS pg_search;   -- ParadeDB BM25
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy / partial-token leg (optional 3rd leg)

-- BM25 index over the content (and optionally a tags-joined text column)
CREATE INDEX memories_bm25 ON public.memories
USING bm25 (memory_id, content, content_type)
WITH (key_field='memory_id');

-- trigram GIN for fuzzy matching of half-remembered identifiers
CREATE INDEX memories_content_trgm ON public.memories
USING gin (content gin_trgm_ops);
```

> **CC note:** confirm whether a `tsvector`/GIN FTS index already exists (the live DB is ahead of the committed `postgresql-working-schema.sql`). If so, you can keep it as a cheap fallback, but `pg_search`'s `@@@` operator replaces `ts_rank_cd` as the primary lexical signal. Don't run both lexical engines in the fusion — pick BM25.

### 1b. Fusion function (the core SQL deliverable)

Standard RRF, `k=60` (the empirical default from Cormack et al. 2009). Three candidate pools → full outer join → summed reciprocal ranks. The trigram leg is optional; include it because the corpus is full of noisy exact tokens.

```sql
CREATE OR REPLACE FUNCTION search_hybrid(
  q_text       text,
  q_vec        vector(768),
  match_count  int DEFAULT 20,
  rrf_k        int DEFAULT 60,
  proj_id      int DEFAULT NULL,
  pool         int DEFAULT 50          -- candidates per leg
)
RETURNS TABLE (memory_id text, content text, score double precision)
LANGUAGE sql STABLE AS $$
WITH bm25 AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY paradedb.score(m.memory_id) DESC) AS rank
  FROM public.memories m
  WHERE m.content @@@ q_text
    AND (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY paradedb.score(m.memory_id) DESC
  LIMIT pool
),
vec AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY m.embedding <=> q_vec) AS rank
  FROM public.memories m
  WHERE (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY m.embedding <=> q_vec
  LIMIT pool
),
fuzz AS (   -- optional third leg; drop if noisy
  SELECT m.memory_id,
         row_number() OVER (ORDER BY similarity(m.content, q_text) DESC) AS rank
  FROM public.memories m
  WHERE m.content % q_text
    AND (proj_id IS NULL OR m.project_id = proj_id)
  ORDER BY similarity(m.content, q_text) DESC
  LIMIT pool
)
SELECT m.memory_id, m.content,
       COALESCE(1.0/(rrf_k + bm25.rank), 0) +
       COALESCE(1.0/(rrf_k + vec.rank),  0) +
       COALESCE(1.0/(rrf_k + fuzz.rank), 0) AS score
FROM bm25
FULL OUTER JOIN vec  USING (memory_id)
FULL OUTER JOIN fuzz USING (memory_id)
JOIN public.memories m USING (memory_id)
ORDER BY score DESC
LIMIT match_count;
$$;
```

### 1c. Python query path (CLI)

The CLI embeds the query via Ollama, then calls the SQL function. Use `psycopg` (v3) with the `pgvector` adapter so Python lists map straight to `vector` without manual casting.

```python
# search.py  (sketch)
import psycopg
from pgvector.psycopg import register_vector
import httpx

OLLAMA = "http://localhost:11434/api/embeddings"

def embed(text: str) -> list[float]:
    r = httpx.post(OLLAMA, json={"model": "nomic-embed-text", "prompt": text})
    return r.json()["embedding"]                      # 768-dim

def search_hybrid(conn, query: str, project_id: int | None = None, k: int = 20):
    qvec = embed(query)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT memory_id, content, score "
            "FROM search_hybrid(%s, %s, %s, 60, %s)",
            (query, qvec, k, project_id),
        )
        return cur.fetchall()

# at startup:
conn = psycopg.connect("dbname=claude_mem")           # existing DSN
register_vector(conn)                                  # lets %s bind a py list -> vector
```

**Libraries:** `psycopg[binary]>=3`, `pgvector` (Python package — provides `register_vector`), `httpx` (or reuse whatever Ollama client the codebase already has). `register_vector` is the thing that makes `qvec` (a plain list) bind correctly to the `vector(768)` parameter — without it you'd be string-casting, which is slow and ugly.

**Exit criteria for Phase 1:** on a hand-built set of ~20 queries (mix of exact-token and conceptual), hybrid beats vector-only on recall@10. Log per-leg contribution so you can see which leg carried each result (don't hide it behind the blended score).

---

## Phase 2 — Cross-encoder reranking (local, in-process)

**Why:** RRF gives good recall but mediocre top-k precision. A cross-encoder reads (query, candidate) pairs jointly and reorders. Pattern: retrieve ~50 via `search_hybrid`, rerank, keep top ~10. Biggest precision jump in the literature.

**Model:** `BAAI/bge-reranker-v2-m3` — open, local, runs on your GPU fleet. Same reranker family Zep/Graphiti uses internally, so it's well-trodden for memory workloads.

**Architecture change from the MCP version:** with no Node boundary, the reranker is **an import in the same Python process**, not a FastAPI sidecar. Simpler, no HTTP hop. The one caveat: model load (~2GB) is slow, so for an interactive CLI you don't want to pay it on every invocation. Two options, in order of preference:

- **(a) Persistent local rerank daemon** on the GPU box (kj), loaded once, the CLI hits it over localhost. This is the sidecar after all — but justified purely by model-load latency, not by language boundaries.
- **(b) In-process load** if rerank runs in a long-lived CLI session or batch context where the load cost amortizes.

```python
# rerank.py  (sketch) — in-process import
from FlagEmbedding import FlagReranker

_reranker = None
def get_reranker():
    global _reranker
    if _reranker is None:
        _reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
    return _reranker

def rerank(query: str, candidates: list[dict], top_k: int = 10) -> list[dict]:
    rk = get_reranker()
    pairs  = [[query, c["content"]] for c in candidates]
    scores = rk.compute_score(pairs, normalize=True)
    ranked = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
    return [{**c, "rerank_score": float(s)} for c, s in ranked[:top_k]]
```

```python
# usage in the CLI search path
rows = search_hybrid(conn, query, k=50)               # wide recall
cands = [{"memory_id": r[0], "content": r[1]} for r in rows]
final = rerank(query, cands, top_k=10)                # precise top-k
```

**Libraries:** `FlagEmbedding` (BGE family), `torch`. Pin `use_fp16=True` on the H200s. Keep rerank **behind a flag** so the system degrades gracefully to plain hybrid if the model/daemon is unavailable.

**Decision for the local session:** pick (a) daemon vs (b) in-process based on how the CLI is actually invoked. If most calls are one-shot `claude-mem search ...`, the daemon wins on latency; if search happens inside longer-lived sessions, in-process is simpler.

**Exit criteria:** rerank improves precision@5 on the eval set without pushing latency past your interactive budget (cross-encoder on 50 short candidates is tens of ms on an H200, once loaded).

---

## Phase 3 — Temporal validity (borrow Graphiti's bi-temporal idea)

**Why:** the corpus is full of facts that *change* — "kj runs DeepSeek-V4-Flash (as of late May)", "ben on 25.10, migrating to 26.04". Flat storage returns superseded and current facts with equal confidence. Bi-temporal modeling lets you ask "what's true now" and "what was true on date X", and surfaces supersession instead of contradiction.

**The pattern (four timestamps), grafted onto existing tables — NOT a graph DB:**

- `valid_at`   — when the fact became true in the world
- `invalid_at` — when it stopped being true (NULL = still true)
- `created_at` — when the system ingested it (already present)
- `expired_at` — system-side logical deletion / versioning (NULL = live)

```sql
ALTER TABLE public.memories
  ADD COLUMN valid_at   timestamptz,
  ADD COLUMN invalid_at timestamptz,
  ADD COLUMN expired_at timestamptz;

CREATE INDEX idx_memories_validity
  ON public.memories (valid_at, invalid_at)
  WHERE expired_at IS NULL;
```

**Supersession mechanic (the important part):** when a new fact contradicts an existing one about the same entity, you don't delete the old row — you set its `invalid_at = valid_at` of the new fact. "Current" queries filter `invalid_at IS NULL AND expired_at IS NULL`; historical queries filter on the validity window.

```sql
-- "what is true now" filter, added to search_hybrid's pools
WHERE (invalid_at IS NULL AND expired_at IS NULL)

-- "what was true on 2026-05-15"
WHERE valid_at <= '2026-05-15' AND (invalid_at IS NULL OR invalid_at > '2026-05-15')
```

**Two honest cautions, both from Graphiti's own bug tracker:**

1. **Contradiction detection is the hard, LLM-heavy part.** Deciding *that* a new fact supersedes an old one (vs. coexists) requires an LLM comparison step at write time. This is where Zep's per-conversation token cost balloons (reports of 600k+ tokens/conversation vs Mem0's ~1.8k). **Recommendation:** start *read-side only* — add the columns, populate `valid_at` from existing `created_at`, leave `invalid_at` NULL, and add the "current vs historical" query filters. Defer automated supersession until you have a concrete "what was true when" pain point. 80% of the value for ~0% of the write-time cost. Conveniently, this Python-only stack makes the eventual LLM supersession step easy to add — it's just another function in the ingest path, calling whatever model you point it at (local on kj, or otherwise).
2. **Never let the extractor guess dates.** A live Graphiti bug: ambiguous past-tense facts collapse to "today," erasing the temporal axis. If/when you add LLM date extraction, the rule must be: a mandatory reference timestamp is the only fallback; never substitute "now"; keep `invalid_at` null-by-default and only set it on explicit supersession.

**Exit criteria:** "current state" queries stop returning superseded facts; a spot-check of "what was X as of <date>" returns the right historical value. No write-path cost increase in the read-side-only version.

---

## Sequencing & dependency summary

| Phase | New infra | Risk | Ships value |
|------|-----------|------|-------------|
| 1 Hybrid | `pg_search`, `pg_trgm` extensions + SQL fn + psycopg path | low | immediately (exact-token recall) |
| 2 Rerank | BGE model; daemon-on-kj or in-process | low–med | precision@k |
| 3 Temporal (read-side) | 3 columns + 1 index | low | "what's true now" correctness |
| 3+ Temporal (supersession) | LLM write-step (now trivial to add — pure Python ingest hook) | **high cost** | only if temporal queries hurt |

**Do Phase 1 fully before touching 2. Do read-side Phase 3 cheaply anytime — it's independent of 1/2.** Hold automated supersession until proven necessary.

## Library shopping list (all Python now)

- **Postgres:** `pg_search` (ParadeDB), `pg_trgm`, existing `vector` (pgvector). Confirm `pg_search` build/install for your PG 17 on the target host.
- **CLI / DB:** `psycopg[binary]>=3`, `pgvector` (Python pkg, for `register_vector`), `httpx` for Ollama (or existing client).
- **Reranker:** `FlagEmbedding`, `torch`. Model `BAAI/bge-reranker-v2-m3`.
- **Embeddings:** unchanged — Ollama `nomic-embed-text`, 768-dim.

## Open questions for the local session to resolve against the live DB

1. Does a `tsvector` FTS index already exist? (live DB ≠ committed schema dump)
2. Is `memory_relationships` actually populated, or effectively empty? (decides whether graph-traversal queries are worth adding later)
3. Confirm `pg_search` availability/build path on the host's PG 17.
4. Reranker as persistent daemon on kj vs in-process — depends on how the CLI is invoked (one-shot vs long-lived session).
