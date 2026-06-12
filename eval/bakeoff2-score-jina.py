# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "transformers"]
# ///
#
# Author: PB and Claude
# Date: 2026-06-12
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff2-score-jina.py
#
# Bake-off round 2: jinaai/jina-reranker-v3 (0.6B LISTWISE). Candidates are
# scored in one context window via the model's rerank() (trust_remote_code).
# Listwise rerankers are input-order sensitive, so the harness shuffles the
# candidate order with a per-query deterministic seed; --permutations N>1
# scores N shuffles and averages the relevance per candidate (web-claude
# briefing: order-randomization or score-averaging belongs in the harness).
# Same output schema as bakeoff2-score-pointwise.py.
#
# Usage:
#   uv run eval/bakeoff2-score-jina.py --pools /tmp/bakeoff-pools-50.json \
#       --out /tmp/bakeoff2-jina-50.json [--permutations 3]

import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path

MODEL = "jinaai/jina-reranker-v3"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--permutations", type=int, default=1)
    ap.add_argument("--block-ctx", type=int, default=8192,
                    help="clamp tokenizer.model_max_length; jina's rerank() packs "
                         "docs into blocks of this many tokens. The tokenizer "
                         "default is so large that the whole pool lands in ONE "
                         "attention window (72-262GiB SDPA buffer on MPS).")
    ap.add_argument("--max-doc-length", type=int, default=1024)
    a = ap.parse_args()

    import torch
    from transformers import AutoModel

    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {MODEL} on {device}", file=sys.stderr)
    model = AutoModel.from_pretrained(MODEL, dtype="auto", trust_remote_code=True).eval().to(device)
    model._ensure_tokenizer()
    model._tokenizer.model_max_length = a.block_ctx

    pools = json.loads(Path(a.pools).read_text())
    rows_in = pools["queries"]
    out_rows = []
    hits = 0
    t_total = 0.0
    for i, r in enumerate(rows_in, 1):
        cands = r["pool"]
        n_c = len(cands)
        sums = [0.0] * n_c
        t0 = time.time()
        for p in range(a.permutations):
            seed = int(hashlib.sha256(f"{r['id']}:{p}".encode()).hexdigest()[:8], 16)
            perm = list(range(n_c))
            random.Random(seed).shuffle(perm)
            docs = [cands[j]["content"] for j in perm]
            with torch.no_grad():
                results = model.rerank(r["query"], docs, max_doc_length=a.max_doc_length)
            for res in results:
                sums[perm[res["index"]]] += float(res["relevance_score"])
        dt = time.time() - t0
        t_total += dt
        if device == "mps":
            torch.mps.empty_cache()  # buffers accumulate across rerank() calls -> OOM at ~80GB
        scores = [s / a.permutations for s in sums]
        order = sorted(range(n_c), key=lambda j: -scores[j])
        ids = [cands[j]["memory_id"] for j in order]
        rks = [scores[j] for j in order]
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
        "model": f"{MODEL} (listwise, perms={a.permutations}, block_ctx={a.block_ctx}, max_doc_len={a.max_doc_length})", "pools": a.pools,
        "n": n, "pool_width": pools.get("pool"),
        "hit_at_1": hits, "hit_at_1_rate": round(hits / n, 4) if n else None,
        "secs_per_query_local": round(t_total / n, 3) if n else None,
        "device": device,
        "rows": out_rows,
    }))
    print(f"jina-v3: hit@1 {hits}/{n} ({hits/n:.1%})  {t_total/n:.2f}s/query local -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
