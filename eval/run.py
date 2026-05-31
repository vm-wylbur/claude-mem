# Author: PB and Claude
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/run.py
#
# Baseline retrieval eval for claude-mem search. For each golden query,
# call a search backend, find the rank of the expected target memory_id,
# and report recall@5, recall@10, and MRR -- overall and by query kind.
#
# vector mode hits the live production REST /search via the mem-search.sh
# shim (the same path real clients use), so the baseline is what clients
# actually get today. hybrid mode is wired in once the search_hybrid SQL
# function exists, run over the identical golden set to measure lift.
#
# Usage:  uv run eval/run.py                 # vector baseline, limit 10
#         uv run eval/run.py --limit 20
#         uv run eval/run.py --show-top 5     # also print top hits per query

import argparse
import json
import re
import statistics
import subprocess
import sys
import urllib.request
from pathlib import Path

MEMID_RE = re.compile(r"^[0-9a-f]{15,16}$")  # guard against psql feedback/notice lines

SHIM = Path.home() / ".claude" / "lib" / "mem-search.sh"
GOLDEN = Path(__file__).parent / "golden.jsonl"
KINDS = ["exact-id", "id-topic", "conceptual"]

OLLAMA = "http://localhost:11434/api/embeddings"  # same nomic-embed-text the server uses
EMBED_MODEL = "nomic-embed-text"
DB_PROJECT = "0000000000000001"  # production devProjectId (matches REST /search scope)


def search_vector(query: str, limit: int) -> list[str]:
    """Ordered memory_ids from the live REST /search (production vector path)."""
    payload = json.dumps({"query": query, "limit": limit})
    proc = subprocess.run(
        ["bash", str(SHIM)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=40,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"shim failed: {proc.stderr.strip() or proc.stdout.strip()}")
    data = json.loads(proc.stdout)
    return [m["memory_id"] for m in data.get("memories", [])]


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def search_hybrid(query: str, limit: int) -> list[str]:
    """Ordered memory_ids from search_hybrid() on snowball (FTS + vector + trgm + RRF)."""
    veclit = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        f"SELECT memory_id FROM search_hybrid("
        f"$q${query}$q$, '{veclit}'::vector, {limit}, 60, '{DB_PROJECT}');"
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
    return [ln.strip() for ln in proc.stdout.splitlines() if MEMID_RE.match(ln.strip())]


BACKENDS = {"vector": search_vector, "hybrid": search_hybrid}


def rank_of(target: str, ids: list[str]) -> int | None:
    for i, mid in enumerate(ids, 1):
        if mid == target:
            return i
    return None


def agg(subset: list[dict]) -> tuple[int, float, float, float]:
    n = len(subset)
    if not n:
        return (0, 0.0, 0.0, 0.0)
    return (
        n,
        sum(x["hit5"] for x in subset) / n,
        sum(x["hit10"] for x in subset) / n,
        statistics.mean(x["rr"] for x in subset),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=list(BACKENDS), default="vector")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--show-top", type=int, default=0, help="print N top hits per query")
    args = ap.parse_args()

    backend = BACKENDS[args.mode]
    golden = [json.loads(ln) for ln in GOLDEN.read_text().splitlines() if ln.strip()]

    rows = []
    for g in golden:
        ids = backend(g["query"], args.limit)
        r = rank_of(g["target"], ids)
        rows.append(
            {
                **g,
                "rank": r,
                "hit5": bool(r and r <= 5),
                "hit10": bool(r and r <= 10),
                "rr": (1.0 / r if r else 0.0),
                "top": ids[: args.show_top],
            }
        )

    print(f"\n  mode={args.mode}  limit={args.limit}  n={len(rows)}\n")
    print(f"  {'rank':>5}  {'kind':<11}  query")
    print("  " + "-" * 72)
    for x in sorted(rows, key=lambda r: (KINDS.index(r["kind"]), r["rank"] or 999)):
        rk = "MISS" if x["rank"] is None else str(x["rank"])
        print(f"  {rk:>5}  {x['kind']:<11}  {x['query'][:54]}")
        if args.show_top and x["top"]:
            print(f"         top: {' '.join(x['top'])}")

    print("\n  " + "-" * 72)
    print(f"  {'kind':<12} {'n':>3}  {'recall@5':>9} {'recall@10':>10} {'MRR':>7}")
    for kind in KINDS:
        n, r5, r10, mrr = agg([x for x in rows if x["kind"] == kind])
        print(f"  {kind:<12} {n:>3}  {r5:>9.2f} {r10:>10.2f} {mrr:>7.3f}")
    n, r5, r10, mrr = agg(rows)
    print(f"  {'ALL':<12} {n:>3}  {r5:>9.2f} {r10:>10.2f} {mrr:>7.3f}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
