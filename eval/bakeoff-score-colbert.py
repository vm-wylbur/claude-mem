# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pylate",
#   "numpy",
#   "torch",
# ]
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff-score-colbert.py
#
# Stage 2b of the rerank-slot bake-off: arm A2 (ColBERT late-interaction,
# GTE-ModernColBERT-v1, local Mac MPS via PyLate). Runs in its OWN uv env so its
# torch/transformers pins can't crash the proven bge CrossEncoder path
# (bakeoff-score.py). Reads the pools (for content) + the bge orders (A0/A1),
# adds ids_A2, and writes a SEPARATE merged file -- so a ColBERT/MPS failure
# leaves the A0/A1 result untouched (degrade-gracefully at the process level).
#
# MaxSim(Q,D) = sum over query tokens of max over doc tokens of dot-product;
# token vectors are L2-normalized here so dot == cosine regardless of PyLate's
# default. Smoke-tests one query before the full pass.
#
# Usage:
#   uv run eval/bakeoff-score-colbert.py --pools /tmp/bakeoff-pools.json \
#       --orders /tmp/bakeoff-orders.json --out /tmp/bakeoff-orders-abc.json \
#       [--doc-len 512] [--limit N]

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", default="/tmp/bakeoff-pools.json")
    ap.add_argument("--orders", default="/tmp/bakeoff-orders.json", help="bge orders (A0/A1) to merge")
    ap.add_argument("--out", default="/tmp/bakeoff-orders-abc.json")
    ap.add_argument("--doc-len", type=int, default=512)
    ap.add_argument("--batch", type=int, default=32, help="encode batch size; lower for long docs (MPS 4GB/tensor cap)")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    pools = {q["id"]: q for q in json.loads(Path(a.pools).read_text())["queries"]}
    bge = json.loads(Path(a.orders).read_text())
    order_rows = bge["orders"]
    if a.limit:
        order_rows = order_rows[: a.limit]

    import numpy as np
    import torch
    from pylate import models
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"  [colbert] device={device} doc_len={a.doc_len} loading GTE-ModernColBERT-v1...", file=sys.stderr)
    model = models.ColBERT("lightonai/GTE-ModernColBERT-v1", device=device, document_length=a.doc_len)

    def _norm(m):
        m = np.asarray(m, dtype=np.float32)
        if m.ndim == 1:
            m = m.reshape(1, -1)
        n = np.linalg.norm(m, axis=1, keepdims=True)
        return m / np.clip(n, 1e-9, None)  # L2-normalize -> dot == cosine

    def encode_batch(texts, is_query):
        # length-sorted so a long doc doesn't pad a whole batch up to its length
        # (and a small --batch keeps the MPS attention tensor under the 4GB cap).
        idx = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        embs_sorted = model.encode([texts[i] for i in idx], is_query=is_query,
                                   batch_size=a.batch, show_progress_bar=False)
        out = [None] * len(texts)
        for pos, i in enumerate(idx):
            out[i] = _norm(embs_sorted[pos])
        return out  # list of [tokens, dim] matrices, original order

    def maxsim(qm, dm):
        return float((qm @ dm.T).max(axis=1).sum())

    # smoke: fail fast on API / MPS-kernel mismatch
    probe = next((r for r in order_rows if pools[r["id"]]["pool"]), None)
    if probe is None:
        print("  [colbert] no non-empty pools", file=sys.stderr); return 2
    qm = encode_batch([pools[probe["id"]]["query"]], True)[0]
    dm = encode_batch([pools[probe["id"]]["pool"][0]["content"]], False)[0]
    print(f"  [colbert] smoke ok (q_tok={qm.shape}, d_tok={dm.shape}, maxsim={maxsim(qm, dm):.3f})", file=sys.stderr)

    for i, r in enumerate(order_rows, 1):
        pool = pools[r["id"]]["pool"]
        if not pool:
            r["ids_A2"] = []
            continue
        qm = encode_batch([pools[r["id"]]["query"]], True)[0]
        dms = encode_batch([c["content"] for c in pool], False)  # whole pool in one batch
        scored = [(c["memory_id"], maxsim(qm, dm)) for c, dm in zip(pool, dms)]
        scored.sort(key=lambda x: x[1], reverse=True)
        r["ids_A2"] = [mid for mid, _ in scored]
        if i % 10 == 0 or i == len(order_rows):
            print(f"  [colbert] {i}/{len(order_rows)}", file=sys.stderr)

    out = {"arms": bge["arms"] + ["A2"], "pool": bge.get("pool"), "orders": order_rows}
    Path(a.out).write_text(json.dumps(out))
    print(f"\ndone: arms={out['arms']}  {len(order_rows)} queries -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
