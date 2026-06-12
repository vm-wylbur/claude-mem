# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-12
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff2-score-bge.py
#
# Bake-off round 2: score captured pools with the INCUMBENT bge
# (bge-reranker-v2-m3 on scott:8585 /rerank, the production-faithful path).
# Emits the same schema as bakeoff2-score-pointwise.py so the judge/analysis
# tooling treats every arm identically.
#
# Usage:
#   uv run eval/bakeoff2-score-bge.py --pools /tmp/bakeoff-pools-50.json \
#       --out /tmp/bakeoff2-bge-50.json

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

GATEWAY = "http://scott:8585/rerank"
MODEL = "bge-reranker-v2-m3"


def _key() -> str:
    for ln in Path.home().joinpath(".config/hrdag/api").read_text().splitlines():
        if ln.startswith("API_KEY="):
            return ln.split("=", 1)[1].strip()
    raise RuntimeError("no API_KEY in ~/.config/hrdag/api")


def rerank(query: str, docs: list[str], key: str) -> list[dict]:
    req = urllib.request.Request(
        GATEWAY,
        # truncate_prompt_tokens=512 mirrors prod (src/db/rerank.ts) -- scott's
        # vLLM REJECTS >512-token pairs with 400 instead of truncating.
        data=json.dumps({"model": MODEL, "query": query, "documents": docs,
                         "truncate_prompt_tokens": 512}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["results"]  # [{index, relevance_score}] desc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    key = _key()

    pools = json.loads(Path(a.pools).read_text())
    rows_in = pools["queries"]
    out_rows = []
    hits = 0
    t_total = 0.0
    for i, r in enumerate(rows_in, 1):
        cands = r["pool"]
        t0 = time.time()
        results = rerank(r["query"], [c["content"] for c in cands], key)
        dt = time.time() - t0
        t_total += dt
        ids = [cands[x["index"]]["memory_id"] for x in results]
        rks = [float(x["relevance_score"]) for x in results]
        hit = bool(ids) and ids[0] == r["target"]
        hits += hit
        out_rows.append({
            "id": r["id"], "kind": r["kind"], "band": r.get("band", "B"),
            "target": r["target"], "query": r["query"],
            "ids": ids, "rerank_scores": rks,
            "target_rank": (ids.index(r["target"]) + 1) if r["target"] in ids else None,
            "pool_rank_of_target": r.get("target_pool_rank"),
            "secs": round(dt, 3),
        })
        if i % 20 == 0:
            print(f"  {i}/{len(rows_in)}  ({t_total:.0f}s)", file=sys.stderr)

    n = len(out_rows)
    Path(a.out).write_text(json.dumps({
        "model": f"{MODEL} (scott:8585, incumbent)", "pools": a.pools, "n": n,
        "pool_width": pools.get("pool"),
        "hit_at_1": hits, "hit_at_1_rate": round(hits / n, 4) if n else None,
        "secs_per_query_remote": round(t_total / n, 3) if n else None,
        "rows": out_rows,
    }))
    print(f"bge: hit@1 {hits}/{n} ({hits/n:.1%})  {t_total/n:.2f}s/query -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
