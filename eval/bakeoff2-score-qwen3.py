# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "transformers"]
# ///
#
# Author: PB and Claude
# Date: 2026-06-12
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff2-score-qwen3.py
#
# Bake-off round 2: Qwen/Qwen3-Reranker-4B, instruction-aware pointwise.
# Implements the model card's transformers path verbatim: chat-template
# prefix/suffix, score = P("yes") from the last-token logits over {yes,no}.
# The INSTRUCTION is the experimental knob (web-claude briefing: a tailored
# instruction may recover oblique matches without going listwise).
# Same output schema as bakeoff2-score-pointwise.py.
#
# Usage:
#   uv run eval/bakeoff2-score-qwen3.py --pools /tmp/bakeoff-pools-50.json \
#       --out /tmp/bakeoff2-qwen3-50.json [--batch 4] [--instruction "..."]

import argparse
import json
import sys
import time
from pathlib import Path

MODEL = "Qwen/Qwen3-Reranker-4B"
DEFAULT_INSTRUCTION = (
    "Given a query that may describe what it needs obliquely - by intent, "
    "method, or underlying principle rather than shared keywords - judge "
    "whether this memory answers the query's actual information need. "
    "Match on meaning and intent, not lexical overlap."
)
PREFIX = ("<|im_start|>system\nJudge whether the Document meets the requirements "
          "based on the Query and the Instruct provided. Note that the answer can "
          "only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n")
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--max-length", type=int, default=2048)
    ap.add_argument("--instruction", default=DEFAULT_INSTRUCTION)
    a = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu")
    print(f"loading {MODEL} on {device}", file=sys.stderr)
    tok = AutoTokenizer.from_pretrained(MODEL, padding_side="left")
    model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype="auto").eval().to(device)
    token_false = tok.convert_tokens_to_ids("no")
    token_true = tok.convert_tokens_to_ids("yes")
    prefix_tokens = tok.encode(PREFIX, add_special_tokens=False)
    suffix_tokens = tok.encode(SUFFIX, add_special_tokens=False)
    body_max = a.max_length - len(prefix_tokens) - len(suffix_tokens)

    def fmt(query: str, doc: str) -> str:
        return (f"<Instruct>: {a.instruction}\n<Query>: {query}\n<Document>: {doc}")

    @torch.no_grad()
    def score_batch(texts: list[str]) -> list[float]:
        enc = tok(texts, padding=False, truncation="longest_first",
                  return_attention_mask=False, max_length=body_max)
        for i in range(len(enc["input_ids"])):
            enc["input_ids"][i] = prefix_tokens + enc["input_ids"][i] + suffix_tokens
        batch = tok.pad(enc, padding=True, return_tensors="pt").to(device)
        logits = model(**batch).logits[:, -1, :]
        pair = torch.stack([logits[:, token_false], logits[:, token_true]], dim=1)
        return torch.nn.functional.log_softmax(pair.float(), dim=1)[:, 1].exp().cpu().tolist()

    pools = json.loads(Path(a.pools).read_text())
    rows_in = pools["queries"]
    out_rows = []
    hits = 0
    t_total = 0.0
    for i, r in enumerate(rows_in, 1):
        cands = r["pool"]
        texts = [fmt(r["query"], c["content"]) for c in cands]
        t0 = time.time()
        scores: list[float] = []
        for b in range(0, len(texts), a.batch):
            scores.extend(score_batch(texts[b:b + a.batch]))
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
        if i % 10 == 0:
            print(f"  {i}/{len(rows_in)}  ({t_total:.0f}s)", file=sys.stderr)

    n = len(out_rows)
    Path(a.out).write_text(json.dumps({
        "model": MODEL, "instruction": a.instruction, "pools": a.pools, "n": n,
        "pool_width": pools.get("pool"),
        "hit_at_1": hits, "hit_at_1_rate": round(hits / n, 4) if n else None,
        "secs_per_query_local": round(t_total / n, 3) if n else None,
        "device": device,
        "rows": out_rows,
    }))
    print(f"qwen3-4b: hit@1 {hits}/{n} ({hits/n:.1%})  {t_total/n:.2f}s/query local -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
