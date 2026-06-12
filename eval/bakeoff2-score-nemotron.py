# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "transformers>=4.44"]
# ///
#
# Author: PB and Claude
# Date: 2026-06-12
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff2-score-nemotron.py
#
# Bake-off round 2: nvidia/llama-nemotron-rerank-1b-v2. Custom architecture
# (LlamaBidirectionalForSequenceClassification, trust_remote_code) with a
# single-sequence prompt template -- per the model card verbatim:
#   "question:{q} \n \n passage:{p}", left padding, max_length 512,
#   raw logit output (monotonic in relevance; no sigmoid needed for ranking).
# Same output schema as bakeoff2-score-pointwise.py.
#
# Usage:
#   uv run eval/bakeoff2-score-nemotron.py --pools /tmp/bakeoff-pools-50.json \
#       --out /tmp/bakeoff2-nemotron-50.json [--batch 8]

import argparse
import json
import sys
import time
from pathlib import Path

MODEL = "nvidia/llama-nemotron-rerank-1b-v2"


def prompt_template(q: str, p: str) -> str:
    return f"question:{q} \n \n passage:{p}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--max-length", type=int, default=512)
    a = ap.parse_args()

    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {MODEL} on {device}", file=sys.stderr)
    tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True, padding_side="left")
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL, trust_remote_code=True, torch_dtype="auto").eval()
    if model.config.pad_token_id is None:
        model.config.pad_token_id = tok.eos_token_id
    model = model.to(device)

    pools = json.loads(Path(a.pools).read_text())
    rows_in = pools["queries"]
    out_rows = []
    hits = 0
    t_total = 0.0
    with torch.no_grad():
        for i, r in enumerate(rows_in, 1):
            cands = r["pool"]
            texts = [prompt_template(r["query"], c["content"]) for c in cands]
            t0 = time.time()
            scores: list[float] = []
            for b in range(0, len(texts), a.batch):
                batch = tok(texts[b:b + a.batch], padding=True, truncation=True,
                            return_tensors="pt", max_length=a.max_length).to(device)
                logits = model(**batch).logits.squeeze(-1)
                scores.extend(float(x) for x in logits.cpu())
            dt = time.time() - t0
            t_total += dt
            order = sorted(range(len(cands)), key=lambda j: -scores[j])
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
        "model": MODEL, "pools": a.pools, "n": n,
        "pool_width": pools.get("pool"),
        "hit_at_1": hits, "hit_at_1_rate": round(hits / n, 4) if n else None,
        "secs_per_query_local": round(t_total / n, 3) if n else None,
        "device": device,
        "rows": out_rows,
    }))
    print(f"nemotron: hit@1 {hits}/{n} ({hits/n:.1%})  {t_total/n:.2f}s/query local -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
