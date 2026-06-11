# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-11
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/legpool-ablation.py
#
# Pool-width × leg-subset ablation of CANDIDATE GENERATION (roadmap §3.1a;
# pre-consolidation baseline). Question: on B1 (oblique, no identifiers,
# hit@1 0.39 live) does the target miss because it sits just OUTSIDE the
# pool (widening helps) or because no leg reaches it at any depth (E4 /
# reformulation territory)?
#
# Method: ONE wide call per query — search_hybrid_candidates(pool=1300,
# >= store size) returns the target's per-leg ranks (fts/vec/trgm; vec
# ranks EVERY embedded memory, so the target always has a vec rank). From
# those three numbers, containment at ANY pool width P and ANY leg subset
# is exact: target enters the fused pool iff min(rank over active legs)
# <= P (each leg is LIMIT P then FULL OUTER JOINed). No telemetry rows, no
# rerank, read-only on snowball.
#
# Usage:
#   uv run eval/legpool-ablation.py --queries /tmp/bandb-queries.jsonl \
#       --out /tmp/legpool-ablation.json

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OLLAMA = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"
DB_PROJECT = "0000000000000001"
WIDE = 1300          # >= live store size -> exhaustive leg depth
POOLS = [50, 100, 200, 400, WIDE]
SUBSETS = {          # leg subsets: containment = min(active ranks) <= P
    "fts+vec+trgm": ("fts", "vec", "trgm"),
    "fts+vec": ("fts", "vec"),
    "vec only": ("vec",),
    "fts only": ("fts",),
    "trgm only": ("trgm",),
    "fts+trgm (no vec)": ("fts", "trgm"),
}


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        OLLAMA, data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def target_ranks(query: str, target: str) -> dict | None:
    vec = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        "SELECT json_agg(t) FROM (SELECT fts_rank, vec_rank, trgm_rank FROM "
        f"search_hybrid_candidates($q${query}$q$, '{vec}'::vector, 60, '{DB_PROJECT}', {WIDE}) "
        f"WHERE memory_id = $q${target}$q$) t;"
    )
    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "snowball", "psql -d claude_mem -qAt -f -"],
        input=sql, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[:300])
    out = proc.stdout.strip().splitlines()
    out = [l for l in out if l.startswith("[") or l == ""]
    rows = json.loads(out[-1]) if out and out[-1] else None
    return rows[0] if rows else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    queries = [json.loads(ln) for ln in Path(a.queries).read_text().splitlines() if ln.strip()]
    rows, t0 = [], time.time()
    for i, q in enumerate(queries, 1):
        r = target_ranks(q["query"], q["target"])
        rows.append({
            "id": q["id"], "kind": q["kind"], "target": q["target"], "query": q["query"],
            "fts": r["fts_rank"] if r else None,
            "vec": r["vec_rank"] if r else None,
            "trgm": r["trgm_rank"] if r else None,
            "found_wide": r is not None,
        })
        if i % 20 == 0:
            print(f"  {i}/{len(queries)} ({time.time()-t0:.0f}s)", file=sys.stderr)
    Path(a.out).write_text(json.dumps({"wide": WIDE, "n": len(rows), "rows": rows}, indent=1))

    def minrank(r, legs):
        vals = [r[l] for l in legs if r[l] is not None]
        return min(vals) if vals else None

    kinds = sorted(set(r["kind"] for r in rows))
    print(f"\n  CONTAINMENT (target in fused pool) — {len(rows)} queries, wide={WIDE}")
    for label, legs in SUBSETS.items():
        print(f"\n  legs = {label}")
        hdr = "    {:<6}".format("") + "".join(f"  P={p:<5}" for p in POOLS)
        print(hdr)
        for k in kinds + ["ALL"]:
            sel = rows if k == "ALL" else [r for r in rows if r["kind"] == k]
            cells = []
            for p in POOLS:
                n_in = sum(1 for r in sel if (m := minrank(r, legs)) is not None and m <= p)
                cells.append(f"  {n_in/len(sel):.3f} ")
            print(f"    {k:<6}" + "".join(cells))

    print("\n  B1 MISSES at prod pool=50 (full legs): where does the target sit?")
    b1 = [r for r in rows if r["kind"] == "B1"]
    misses = [r for r in b1 if (m := minrank(r, ("fts", "vec", "trgm"))) is None or m > 50]
    print(f"    {len(misses)}/{len(b1)} B1 targets outside the pool at P=50")
    buckets = {"51-100": 0, "101-200": 0, "201-400": 0, f"401-{WIDE}": 0, "absent-all-legs": 0}
    for r in misses:
        m = minrank(r, ("fts", "vec", "trgm"))
        if m is None: buckets["absent-all-legs"] += 1
        elif m <= 100: buckets["51-100"] += 1
        elif m <= 200: buckets["101-200"] += 1
        elif m <= 400: buckets["201-400"] += 1
        else: buckets[f"401-{WIDE}"] += 1
    for b, n in buckets.items():
        print(f"      {b:<16} {n}")
    print("\n  FIRST-FINDER leg (which leg holds the target's best rank), per kind:")
    for k in kinds:
        sel = [r for r in rows if r["kind"] == k]
        wins = {"fts": 0, "vec": 0, "trgm": 0, "none": 0}
        for r in sel:
            best, bl = None, "none"
            for l in ("fts", "vec", "trgm"):
                if r[l] is not None and (best is None or r[l] < best):
                    best, bl = r[l], l
            wins[bl] += 1
        print(f"    {k}: " + "  ".join(f"{l}={n}" for l, n in wins.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
