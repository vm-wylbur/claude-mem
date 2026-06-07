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
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/rerank-debug.py
#
# THROWAWAY. The model scores clean docs correctly (rerank-sanity.py passes) but
# the probe drives REAL gold memories to pool-bottom. This dumps, for ONE golden
# query, every hybrid candidate's rerank score + content length + gold flag, plus
# the gold's full content -- to SEE why gold scores low (truncation? diluted
# content? boilerplate?) instead of guessing.
#
#   uv run eval/rerank-debug.py            # default query id 1 (upsmon, gold->rank 24)
#   uv run eval/rerank-debug.py 9          # log_journald

import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

MEMID_RE = re.compile(r"^[0-9a-f]{15,16}$")
GOLDEN = Path(__file__).parent / "golden.jsonl"
OLLAMA = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"
DB_PROJECT = "0000000000000001"
POOL = 40
MODEL = os.environ.get("RERANK_MODEL", "tomaarsen/Qwen3-Reranker-0.6B-seq-cls")
MAXLEN = 512

want_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1


def embed(text):
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": EMBED_MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["embedding"]


def candidates(query):
    veclit = "[" + ",".join(str(x) for x in embed(query)) + "]"
    sql = (
        "SELECT json_agg(t) FROM (SELECT memory_id, content FROM search_hybrid("
        f"$q${query}$q$, '{veclit}'::vector, {POOL}, 60, '{DB_PROJECT}')) t;"
    )
    proc = subprocess.run(
        ["ssh", "snowball", "psql -d claude_mem -q -tA -f -"],
        input=sql, capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip())
    return [r for r in (json.loads(proc.stdout) or []) if MEMID_RE.match(r["memory_id"])]


g = next(json.loads(ln) for ln in GOLDEN.read_text().splitlines()
         if ln.strip() and json.loads(ln)["id"] == want_id)
print(f"query id={g['id']}  kind={g['kind']}  gold={g['target']}")
print(f"query: {g['query']}\n")

cands = candidates(g["query"])

import torch
from sentence_transformers import CrossEncoder

# token count via the model's own tokenizer, to see truncation directly
from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained(MODEL)

device = "mps" if torch.backends.mps.is_available() else "cpu"
model = CrossEncoder(MODEL, device=device, max_length=MAXLEN, model_kwargs={"torch_dtype": torch.float16})
scores = model.predict([(g["query"], c["content"]) for c in cands], show_progress_bar=False)

rows = []
for hyb_rank, (c, s) in enumerate(zip(cands, scores), 1):
    ntok = len(tok(g["query"], c["content"])["input_ids"])
    rows.append({
        "hyb": hyb_rank, "score": float(s), "ntok": ntok,
        "trunc": ntok > MAXLEN, "gold": c["memory_id"] == g["target"],
        "id": c["memory_id"], "chars": len(c["content"]),
        "preview": c["content"][:80].replace("\n", " "),
    })

ranked = sorted(rows, key=lambda r: r["score"], reverse=True)
print(f"  {'rrk':>3} {'hyb':>3} {'score':>8} {'ntok':>5} {'tr':>2} {'chars':>6}  g  preview")
print("  " + "-" * 100)
for rrk, r in enumerate(ranked, 1):
    print(f"  {rrk:>3} {r['hyb']:>3} {r['score']:>8.4f} {r['ntok']:>5} "
          f"{'Y' if r['trunc'] else ' ':>2} {r['chars']:>6}  {'*' if r['gold'] else ' '}  {r['preview']}")

gold = next((r for r in rows if r["gold"]), None)
print("\n  GOLD:", "NOT IN POOL" if gold is None else
      f"hybrid_rank={gold['hyb']} rerank_rank={ranked.index(gold)+1} "
      f"score={gold['score']:.4f} ntok={gold['ntok']} truncated={gold['trunc']} chars={gold['chars']}")
if gold:
    full = next(c["content"] for c in cands if c["memory_id"] == g["target"])
    print("\n  ===== GOLD CONTENT (full) =====\n")
    # stored memories can contain lone surrogates; don't let the dump crash the run
    sys.stdout.buffer.write(full.encode("utf-8", "replace"))
    sys.stdout.buffer.write(b"\n")
