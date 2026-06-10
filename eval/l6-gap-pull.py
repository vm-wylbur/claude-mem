# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-10
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/l6-gap-pull.py
#
# L6 (neg-6b0a3bf5, ledger item 3) stage 1: pull the RRF score-gap signal for
# the 173 Band-B queries. For each query: embed locally (Ollama
# nomic-embed-text, same model the store uses), call search_hybrid() on
# snowball with PROD parameters (k=60, pool=50, dev project) — the cascade
# would read the gap off the production call, so the eval must measure the
# signal those parameters produce, not the bake-off's pool=100 research pull.
# Capture the top-N (memory_id, score) so gap = score[0]-score[1] and the
# hit@1 label (top1 == target) come from the SAME call.
#
# Read-only on snowball (ControlMaster ssh, BatchMode). Re-pull rather than
# reuse /tmp/bandb-pools.json because the pools stored ids+content only — no
# scores — and the store has grown since 2026-06-07 anyway.
#
# Usage:
#   uv run eval/l6-gap-pull.py --queries /tmp/bandb-queries.jsonl \
#       --out /tmp/l6-gaps.json

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OLLAMA = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"
DB_PROJECT = "0000000000000001"  # production devProjectId (REST /search scope)
PROD_POOL = 50                   # search_hybrid() prod default
PROD_K = 60
TOP_N = 10                       # enough for gap + rank-of-target diagnostics


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def top_scores(query: str) -> list[dict]:
    """Top-N (memory_id, score) from search_hybrid under prod parameters."""
    vec = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        "SELECT json_agg(t) FROM (SELECT memory_id, score FROM search_hybrid("
        f"$q${query}$q$, '{vec}'::vector, {TOP_N}, {PROD_K}, '{DB_PROJECT}', {PROD_POOL})) t;"
    )
    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "snowball", "psql -d claude_mem -q -tA -f -"],
        input=sql, capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr[:300]}")
    out = proc.stdout.strip()
    if not out or out == "":
        return []
    return json.loads(out) or []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    queries = [json.loads(ln) for ln in Path(a.queries).read_text().splitlines() if ln.strip()]
    rows = []
    t0 = time.time()
    for i, q in enumerate(queries, 1):
        top = top_scores(q["query"])
        ids = [c["memory_id"] for c in top]
        scores = [c["score"] for c in top]
        gap = (scores[0] - scores[1]) if len(scores) >= 2 else None
        rows.append({
            "id": q["id"], "kind": q["kind"], "band": q["band"],
            "target": q["target"], "query": q["query"],
            "ids": ids, "scores": scores,
            "gap": gap,
            "hit1": bool(ids) and ids[0] == q["target"],
            "target_rank": (ids.index(q["target"]) + 1) if q["target"] in ids else None,
        })
        if i % 20 == 0:
            print(f"  {i}/{len(queries)}  ({time.time()-t0:.0f}s)", file=sys.stderr)

    Path(a.out).write_text(json.dumps({
        "pool": PROD_POOL, "rrf_k": PROD_K, "top_n": TOP_N,
        "project": DB_PROJECT, "n": len(rows), "rows": rows,
    }, indent=1))
    n_hit = sum(r["hit1"] for r in rows)
    print(f"pulled {len(rows)} queries; hit@1 {n_hit}/{len(rows)} ({n_hit/len(rows):.1%}) -> {a.out}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
