# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff-pull.py
#
# Stage 1 of the rerank-slot bake-off (A0 hybrid / A1 bge / A2 ColBERT).
# Extends rerank-probe.py's hybrid_candidates() into a BATCH puller: for each
# query in a jsonl set, embed locally (Ollama nomic-embed-text, the same model
# the store uses) and pull the search_hybrid() candidate pool (memory_id +
# content) from snowball, ONCE. Everything downstream (scoring each arm,
# computing metrics) then runs fully OFFLINE from the dumped pools -- so a
# dropped ssh ControlMaster mid-run can't corrupt a multi-model pass.
#
# Read-only on snowball. Records pool-containment (is the target even in the
# pool, and at what hybrid rank) -- the ceiling no reranker can exceed.
#
# Usage:
#   uv run eval/bakeoff-pull.py --queries /tmp/bakeoff-queries.jsonl \
#       --out /tmp/bakeoff-pools.json --pool 100

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


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def pool_for(query: str, pool: int) -> list[dict]:
    """search_hybrid pool (memory_id + content), fused-rank order. json_agg so
    embedded newlines in content survive transport. pool passed as BOTH
    match_count and the per-leg pool arg, so the fused net is as wide as asked."""
    vec = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        "SELECT json_agg(t) FROM (SELECT memory_id, content FROM search_hybrid("
        f"$q${query}$q$, '{vec}'::vector, {pool}, 60, '{DB_PROJECT}', {pool})) t;"
    )
    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "snowball", "psql -d claude_mem -q -tA -f -"],
        input=sql, capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql failed")
    out = proc.stdout.strip()
    return json.loads(out) if out else []  # json_agg over 0 rows -> NULL -> empty


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", default="/tmp/bakeoff-queries.jsonl")
    ap.add_argument("--out", default="/tmp/bakeoff-pools.json")
    ap.add_argument("--pool", type=int, default=100)
    a = ap.parse_args()

    qs = [json.loads(l) for l in Path(a.queries).read_text().splitlines() if l.strip()]
    rows = []
    for i, q in enumerate(qs, 1):
        cands = []
        for attempt in (1, 2):
            try:
                cands = pool_for(q["query"], a.pool)
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  [{i}/{len(qs)}] FAIL {q['id']}: {e}", file=sys.stderr)
                else:
                    time.sleep(1.5)
        rank = next((j for j, c in enumerate(cands, 1) if c["memory_id"] == q["target"]), None)
        rows.append({
            **q,
            "pool": [{"memory_id": c["memory_id"], "content": c["content"]} for c in cands],
            "pool_size": len(cands),
            "target_in_pool": rank is not None,
            "target_pool_rank": rank,
        })
        if i % 20 == 0 or i == len(qs):
            hits = sum(1 for r in rows if r["target_in_pool"])
            print(f"  pulled {i}/{len(qs)}  containment={hits}/{i}", file=sys.stderr)

    Path(a.out).write_text(json.dumps({"pool": a.pool, "project": DB_PROJECT, "queries": rows}))
    hits = sum(1 for r in rows if r["target_in_pool"])
    print(f"\ndone: {len(rows)} queries -> {a.out}  pool-containment={hits}/{len(rows)} ({hits/len(rows):.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
