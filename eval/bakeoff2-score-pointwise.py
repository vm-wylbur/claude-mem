# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "sentence-transformers"]
# ///
#
# Author: PB and Claude
# Date: 2026-06-12
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff2-score-pointwise.py
#
# Reranker bake-off round 2 (post-consolidation, roadmap E4-as-reranker):
# score captured candidate pools with any pointwise cross-encoder that
# sentence-transformers' CrossEncoder can load (gte-modernbert, nemotron,
# Qwen3-Reranker seq-cls ports, ...). Runs fully OFFLINE from the
# bakeoff-pull.py dumps -- no snowball, no scott. MPS/CUDA/CPU auto.
#
# Output rows use the l7-bge-scores schema (ids in reranked order +
# rerank_scores aligned) so b1-demotion-audit.py and the look tooling
# consume them unchanged. Wall-clock per query is recorded but is LOCAL
# latency -- relative comparison only, not the prod serving number.
#
# Usage:
#   uv run eval/bakeoff2-score-pointwise.py \
#       --pools /tmp/bakeoff-pools-50.json \
#       --model Alibaba-NLP/gte-reranker-modernbert-base \
#       --out /tmp/bakeoff2-gte-50.json [--trust-remote-code] [--batch 32]

import argparse
import json
import sys
import time
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--max-length", type=int, default=2048)
    ap.add_argument("--trust-remote-code", action="store_true")
    a = ap.parse_args()

    import torch
    from sentence_transformers import CrossEncoder

    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {a.model} on {device}", file=sys.stderr)
    model = CrossEncoder(
        a.model,
        max_length=a.max_length,
        device=device,
        trust_remote_code=a.trust_remote_code,
        automodel_args={"torch_dtype": "auto"},
    )

    pools = json.loads(Path(a.pools).read_text())
    rows_in = pools["queries"] if isinstance(pools, dict) else pools
    out_rows = []
    hits = 0
    t_total = 0.0
    for i, r in enumerate(rows_in, 1):
        cands = r["pool"]  # [{memory_id, content}, ...] fused-rank order
        pairs = [(r["query"], c["content"]) for c in cands]
        t0 = time.time()
        scores = model.predict(pairs, batch_size=a.batch, show_progress_bar=False)
        dt = time.time() - t0
        t_total += dt
        order = sorted(range(len(cands)), key=lambda j: -float(scores[j]))
        ids = [cands[j]["memory_id"] for j in order]
        rks = [float(scores[j]) for j in order]
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
    summary = {
        "model": a.model, "pools": a.pools, "n": n,
        "pool_width": len(rows_in[0]["pool"]) if rows_in else 0,
        "hit_at_1": hits, "hit_at_1_rate": round(hits / n, 4) if n else None,
        "secs_per_query_local": round(t_total / n, 3) if n else None,
        "device": device,
        "rows": out_rows,
    }
    Path(a.out).write_text(json.dumps(summary))
    print(f"{a.model}: hit@1 {hits}/{n} ({hits/n:.1%})  "
          f"{t_total/n:.2f}s/query local -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
