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
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff-score.py
#
# Stage 2a of the rerank-slot bake-off: arms A0 (hybrid, free) + A1 (bge
# cross-encoder, local Mac MPS). DELIBERATELY minimal deps -- exactly the
# rerank-probe.py set, no pylate -- because bundling pylate's torch/transformers
# pins into this env crashed CrossEncoder.predict natively on MPS (no Python
# traceback). A2 (ColBERT) runs in its OWN isolated env: bakeoff-score-colbert.py.
#
# Reads the pools dumped by bakeoff-pull.py; emits per-query ordered id lists.
#
# Usage:
#   uv run eval/bakeoff-score.py --pools /tmp/bakeoff-pools.json \
#       --out /tmp/bakeoff-orders.json [--max-len 512] [--limit N]

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", default="/tmp/bakeoff-pools.json")
    ap.add_argument("--out", default="/tmp/bakeoff-orders.json")
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--limit", type=int, default=0, help="smoke: first N queries only")
    a = ap.parse_args()

    data = json.loads(Path(a.pools).read_text())
    queries = data["queries"]
    if a.limit:
        queries = queries[: a.limit]

    import torch
    from sentence_transformers import CrossEncoder
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"  [bge] device={device} max_len={a.max_len} n={len(queries)}", file=sys.stderr)
    model = CrossEncoder("BAAI/bge-reranker-v2-m3", device=device, max_length=a.max_len,
                         model_kwargs={"torch_dtype": torch.float16})

    for i, q in enumerate(queries, 1):
        q["ids_A0"] = [c["memory_id"] for c in q["pool"]]
        if not q["pool"]:
            q["ids_A1"] = []
            continue
        scores = model.predict([(q["query"], c["content"]) for c in q["pool"]],
                               show_progress_bar=False)
        order = sorted(zip(q["pool"], scores), key=lambda x: float(x[1]), reverse=True)
        q["ids_A1"] = [c["memory_id"] for c, _ in order]
        if i % 25 == 0 or i == len(queries):
            print(f"  [bge] {i}/{len(queries)}", file=sys.stderr)

    out = {
        "arms": ["A0", "A1"],
        "pool": data.get("pool"),
        "orders": [{k: q[k] for k in ("id", "kind", "band", "target", "target_in_pool",
                                      "target_pool_rank", "pool_size", "ids_A0", "ids_A1")
                    if k in q} for q in queries],
    }
    Path(a.out).write_text(json.dumps(out))
    print(f"\ndone: arms=['A0','A1']  {len(queries)} queries -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
