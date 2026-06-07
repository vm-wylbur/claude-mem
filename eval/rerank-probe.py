# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "sentence-transformers>=2.7.0",
#   "transformers>=4.51.0",
#   "torch",
# ]
# ///
#
# Author: PB and Claude
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/rerank-probe.py
#
# THROWAWAY Phase-2 probe: does a cross-encoder rerank lift MRR over the
# live hybrid retriever? Not shipped, not wired into the server. Decides
# whether a production rerank stage (behind an MCPMEM_RERANK flag) is worth
# building, BEFORE any such code or infra exists.
#
# Pipeline per golden query:
#   1. embed query via local Ollama nomic-embed-text (same model the store uses)
#   2. pull POOL hybrid candidates (memory_id + content) from search_hybrid()
#      on snowball -- the same fused retriever clients get today
#   3. rerank (query, content) pairs with a local cross-encoder on MPS
#   4. compare the target's rank across THREE orders:
#        - hybrid  : live search_hybrid() fused order (before)
#        - rerank  : bge cross-encoder order alone (after)
#        - fused   : the GUARD -- bge rerank-rank RRF-fused with hybrid-rank,
#                    so a strong lexical hit can't be demoted out of top-5
#
# Reports recall@5/@10 + MRR, overall and by kind, for all three orders, so
# the lift AND any regression are explicit. recall is already saturated live
# (recall@10=1.00, MRR~0.80); this probe is about ORDERING. bge alone lifts
# MRR but ejected one exact-token gold from top-5 (recall@5 1.00->0.95) -- the
# fused order exists to recover that without losing the MRR win.
#
# Serving stack per the 2026-05-31 web-Claude model review: dedicated
# cross-encoder (NOT an LLM-as-judge), sentence-transformers CrossEncoder on
# the M1 Max Metal/MPS backend (Ollama 0.24 has no rerank endpoint; vLLM has
# no usable Apple-Silicon path). Ollama stays only for embeddings.
#
# Usage:
#   uv run eval/rerank-probe.py                 # default model, pool 40
#   uv run eval/rerank-probe.py --pool 40 --model BAAI/bge-reranker-v2-m3
#   uv run eval/rerank-probe.py --instruction "Given a sysadmin query, judge whether the note answers it."
#
# First run downloads the model (~1.2 GB for the 0.6B) to the HF cache.

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import urllib.request
from pathlib import Path

# Silence HF/tqdm bars so captured stdout stays parseable.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

MEMID_RE = re.compile(r"^[0-9a-f]{15,16}$")
GOLDEN = Path(__file__).parent / "golden.jsonl"
KINDS = ["exact-id", "id-topic", "conceptual"]

OLLAMA = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"
DB_PROJECT = "0000000000000001"  # production devProjectId (REST /search scope)

# bge-reranker-v2-m3 is a classic MS-MARCO cross-encoder: no special prompt
# template, works directly through CrossEncoder.predict(). It is the DEFAULT
# because Qwen3-Reranker-0.6B (an LLM-style reranker needing its
# <Instruct>/<Query>/<Document> template + yes-token logit) scores garbage
# through the generic CrossEncoder path — verified 2026-05-31: on the upsmon
# query, same pool/harness, Qwen3 ranked the verbatim-matching gold #24
# (score 0.057) while bge ranked it #1 (0.9954). Swap with --model to retest
# Qwen3 once its prompt template is wired in.
DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3"


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def hybrid_candidates(query: str, pool: int) -> list[dict]:
    """POOL hybrid candidates (memory_id + content) in fused-rank order.

    json_agg so embedded newlines in content survive transport intact
    (a -tA tab/newline parse would shred multi-line memories).
    """
    veclit = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        "SELECT json_agg(t) FROM ("
        "SELECT memory_id, content FROM search_hybrid("
        f"$q${query}$q$, '{veclit}'::vector, {pool}, 60, '{DB_PROJECT}')"
        ") t;"
    )
    proc = subprocess.run(
        ["ssh", "snowball", "psql -d claude_mem -q -tA -f -"],
        input=sql,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr.strip()}")
    rows = json.loads(proc.stdout) or []
    return [r for r in rows if MEMID_RE.match(r["memory_id"])]


def rank_of(target: str, ids: list[str]) -> int | None:
    for i, mid in enumerate(ids, 1):
        if mid == target:
            return i
    return None


def rrf_fuse(ids_a: list[str], ids_b: list[str], k: int) -> list[str]:
    """Reciprocal-Rank-Fusion of two ranked id lists -> fused id order.

    score(id) = 1/(k+rank_a) + 1/(k+rank_b), descending. This is the GUARD:
    fusing the bge rerank order (ids_b) WITH the hybrid order (ids_a) keeps a
    strong lexical hit (high hybrid rank) from being demoted out of the window
    by the cross-encoder. Same k=60 RRF that search_hybrid() uses, so the
    behavior is consistent with the live fuser. Both lists hold the same ids.
    """
    rank_a = {mid: i for i, mid in enumerate(ids_a, 1)}
    rank_b = {mid: i for i, mid in enumerate(ids_b, 1)}
    ids = set(ids_a) | set(ids_b)
    big = len(ids) + k  # absent-from-a-list penalty (defensive; lists match here)

    def fused_score(mid: str) -> float:
        return 1.0 / (k + rank_a.get(mid, big)) + 1.0 / (k + rank_b.get(mid, big))

    # tie-break on hybrid rank so fusion is deterministic and stable.
    return sorted(ids, key=lambda m: (-fused_score(m), rank_a.get(m, big)))


def agg(subset: list[dict], key: str) -> tuple[int, float, float, float]:
    n = len(subset)
    if not n:
        return (0, 0.0, 0.0, 0.0)
    r = [x[key] for x in subset]
    return (
        n,
        sum(bool(v and v <= 5) for v in r) / n,
        sum(bool(v and v <= 10) for v in r) / n,
        statistics.mean(1.0 / v if v else 0.0 for v in r),
    )


def report(label: str, rows: list[dict], key: str) -> None:
    print(f"\n  === {label} ===")
    print(f"  {'kind':<12} {'n':>3}  {'recall@5':>9} {'recall@10':>10} {'MRR':>7}")
    for kind in KINDS:
        n, r5, r10, mrr = agg([x for x in rows if x["kind"] == kind], key)
        print(f"  {kind:<12} {n:>3}  {r5:>9.2f} {r10:>10.2f} {mrr:>7.3f}")
    n, r5, r10, mrr = agg(rows, key)
    print(f"  {'ALL':<12} {n:>3}  {r5:>9.2f} {r10:>10.2f} {mrr:>7.3f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", type=int, default=40, help="hybrid candidates to rerank")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument(
        "--instruction",
        default="",
        help="optional task instruction prepended to the query (Qwen3-Reranker is instruction-aware; ~1-5%% lift)",
    )
    ap.add_argument(
        "--json-out",
        default="",
        help="write per-query rows + computed aggregates here (terminal-render-proof)",
    )
    ap.add_argument(
        "--dump-orders",
        default="",
        help="write per-query FULL ordered id lists (hybrid + rerank) here, so guard "
        "variants (k-sweep, weighted RRF, pin-top-N) can be evaluated OFFLINE from one "
        "expensive rerank pass instead of reloading the model per config.",
    )
    ap.add_argument(
        "--rrf-k",
        type=int,
        default=60,
        help="RRF constant for the fused (guard) order. Mirrors search_hybrid's k=60. "
        "Larger k flattens rank differences (protects a strong lexical hit from a bad "
        "rerank rank); smaller k sharpens top-rank rewards (favors the rerank lift).",
    )
    ap.add_argument(
        "--max-len",
        type=int,
        default=512,
        help="token cap per (query,doc) pair. Qwen3-Reranker defaults to 32k context; "
        "uncapped, one long memory doc blows MPS attention up to a 38GiB buffer and crashes. "
        "512 is the standard cross-encoder rerank cap and keeps runs deterministic.",
    )
    args = ap.parse_args()

    # Heavy imports after arg parse so --help stays instant.
    import torch
    from sentence_transformers import CrossEncoder

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"  model={args.model}  device={device}  pool={args.pool}  max_len={args.max_len}", file=sys.stderr)
    model = CrossEncoder(
        args.model, device=device, max_length=args.max_len,
        model_kwargs={"torch_dtype": torch.float16},
    )

    def score(q: str, contents: list[str]):
        # show_progress_bar=False: the per-query Batches bar writes \r and
        # corrupts the report when stdout is captured to a file.
        return model.predict([(q, c) for c in contents], show_progress_bar=False)

    golden = [json.loads(ln) for ln in GOLDEN.read_text().splitlines() if ln.strip()]

    rows = []
    orders = []
    for g in golden:
        cands = hybrid_candidates(g["query"], args.pool)
        ids_before = [c["memory_id"] for c in cands]

        q = f"{args.instruction}\n{g['query']}" if args.instruction else g["query"]
        scores = score(q, [c["content"] for c in cands])
        reranked = sorted(zip(cands, scores), key=lambda x: x[1], reverse=True)
        ids_after = [c["memory_id"] for c, _ in reranked]
        ids_fused = rrf_fuse(ids_before, ids_after, args.rrf_k)

        rows.append(
            {
                **g,
                "rank_before": rank_of(g["target"], ids_before),
                "rank_after": rank_of(g["target"], ids_after),
                "rank_fused": rank_of(g["target"], ids_fused),
            }
        )
        orders.append(
            {
                "id": g["id"], "kind": g["kind"], "query": g["query"],
                "target": g["target"], "ids_before": ids_before, "ids_after": ids_after,
            }
        )

    def fmt(v):
        return "MISS" if v is None else str(v)

    print(f"\n  n={len(rows)}  pool={args.pool}  rrf_k={args.rrf_k}\n")
    print(f"  {'kind':<11}  {'hybrid':>6}  {'rerank':>6}  {'fused':>5}  query")
    print("  " + "-" * 76)
    # fused vs hybrid is the shippable comparison: the guard must not demote a
    # gold out of top-5 relative to live hybrid.
    for x in sorted(rows, key=lambda r: (KINDS.index(r["kind"]), r["rank_fused"] or 999)):
        b, a, f = fmt(x["rank_before"]), fmt(x["rank_after"]), fmt(x["rank_fused"])
        bh, fh = (x["rank_before"] or 99), (x["rank_fused"] or 99)
        flag = "  <-- lift" if fh < bh else ("  <-- DROP" if fh > bh else "")
        print(f"  {x['kind']:<11}  {b:>6}  {a:>6}  {f:>5}  {x['query'][:42]}{flag}")

    report("hybrid (before rerank)", rows, "rank_before")
    report("reranked (bge alone)", rows, "rank_after")
    report("fused (GUARD: rerank RRF hybrid)", rows, "rank_fused")
    print()

    if args.json_out:
        def aggdict(subset, key):
            n, r5, r10, mrr = agg(subset, key)
            return {"n": n, "recall@5": round(r5, 4), "recall@10": round(r10, 4), "mrr": round(mrr, 4)}

        summary = {
            "model": args.model,
            "pool": args.pool,
            "rrf_k": args.rrf_k,
            "instruction": args.instruction,
            "hybrid": {k: aggdict([x for x in rows if x["kind"] == k], "rank_before") for k in KINDS}
            | {"ALL": aggdict(rows, "rank_before")},
            "reranked": {k: aggdict([x for x in rows if x["kind"] == k], "rank_after") for k in KINDS}
            | {"ALL": aggdict(rows, "rank_after")},
            "fused": {k: aggdict([x for x in rows if x["kind"] == k], "rank_fused") for k in KINDS}
            | {"ALL": aggdict(rows, "rank_fused")},
            "rows": [
                {"id": x["id"], "kind": x["kind"], "query": x["query"],
                 "before": x["rank_before"], "after": x["rank_after"], "fused": x["rank_fused"]}
                for x in rows
            ],
        }
        Path(args.json_out).write_text(json.dumps(summary, indent=2))

    if args.dump_orders:
        Path(args.dump_orders).write_text(
            json.dumps({"model": args.model, "pool": args.pool, "orders": orders}, indent=2)
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
