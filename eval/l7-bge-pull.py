# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-10
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/l7-bge-pull.py
#
# L7 exploratory stage 1: pull bge rerank_scores for the 173 Band-B queries
# through the LIVE /search REST path (rerank enabled in prod), so the scores
# are exactly what the read-loop cascade would see — same pool, same
# truncate, same serving model. Captures top-N (memory_id, rerank_score) +
# hit@1 per query.
#
# Each call is tagged session_id=bandb-eval-<date> so the telemetry rows
# these searches write are identifiable/excludable in search_events later
# (they are synthetic known-target queries, not organic traffic).
#
# Needs CLAUDE_MEM_SECRET in the environment (same secret the shims use).
#
# Usage:
#   uv run eval/l7-bge-pull.py --queries /tmp/bandb-queries.jsonl \
#       --out /tmp/l7-bge-scores.json

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://snowball:3456"
EVAL_SESSION = "bandb-eval-20260610"
TOP_N = 10


def search(query: str, secret: str) -> list[dict]:
    req = urllib.request.Request(
        f"{BASE}/search",
        data=json.dumps({"query": query, "limit": TOP_N, "session_id": EVAL_SESSION}).encode(),
        headers={"Content-Type": "application/json", "X-Claude-Mem-Secret": secret},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["memories"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    secret = os.environ.get("CLAUDE_MEM_SECRET", "")
    if not secret:
        print("CLAUDE_MEM_SECRET not set", file=sys.stderr)
        return 1

    queries = [json.loads(ln) for ln in Path(a.queries).read_text().splitlines() if ln.strip()]
    rows = []
    t0 = time.time()
    for i, q in enumerate(queries, 1):
        mems = search(q["query"], secret)
        ids = [m["memory_id"] for m in mems]
        scores = [m.get("rerank_score") for m in mems]
        rows.append({
            "id": q["id"], "kind": q["kind"], "band": q["band"],
            "target": q["target"], "query": q["query"],
            "ids": ids, "rerank_scores": scores,
            "hit1": bool(ids) and ids[0] == q["target"],
            "target_rank": (ids.index(q["target"]) + 1) if q["target"] in ids else None,
        })
        if i % 20 == 0:
            print(f"  {i}/{len(queries)}  ({time.time()-t0:.0f}s)", file=sys.stderr)

    n_scored = sum(1 for r in rows if r["rerank_scores"] and r["rerank_scores"][0] is not None)
    n_hit = sum(r["hit1"] for r in rows)
    Path(a.out).write_text(json.dumps({
        "path": "live /search (rerank on)", "top_n": TOP_N,
        "eval_session": EVAL_SESSION, "n": len(rows), "rows": rows,
    }, indent=1))
    print(f"pulled {len(rows)}; top1-scored {n_scored}; hit@1 {n_hit}/{len(rows)} "
          f"({n_hit/len(rows):.1%}) -> {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
