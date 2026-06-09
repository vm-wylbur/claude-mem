# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff-score-bge-scott.py
#
# Drop-in alternative to bakeoff-score.py's A0/A1 stage that scores A1 (bge) on
# scott's 4090 via the live gateway rerank endpoint (POST /rerank, JinaAI-style:
# {model, query, documents} -> {results:[{index, relevance_score}]} sorted desc)
# instead of the local Mac MPS CrossEncoder. SAME model (bge-reranker-v2-m3,
# --max-model-len 512), so directly comparable to the Band-A bge run -- and
# production-faithful, since this is the reranker the live store actually uses.
# Much faster than MPS (the local run wedged); offloads the Mac.
#
# A0 = the hybrid pool order (free). A1 = bge order from scott. Emits the exact
# bakeoff-score.py output shape so bakeoff-score-colbert.py merges A2 and
# bakeoff-analyze.py runs unchanged.
#
# Requires the hrdag bearer (~/.config/hrdag/api API_KEY); gateway needs auth.
#
# Usage:
#   uv run eval/bakeoff-score-bge-scott.py --pools /tmp/bandb-pools.json \
#       --out /tmp/bandb-orders.json [--limit N]

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

GATEWAY = "http://scott:8585/rerank"
MODEL = "bge-reranker-v2-m3"


def _key() -> str:
    for ln in Path.home().joinpath(".config/hrdag/api").read_text().splitlines():
        if ln.startswith("API_KEY="):
            return ln.split("=", 1)[1].strip()
    sys.exit("no API_KEY in ~/.config/hrdag/api (gateway rerank needs the bearer)")


def rerank_order(query: str, pool: list[dict], key: str, retries: int = 3) -> list[str]:
    """Return pool memory_ids ordered by bge relevance (desc). Indices in the
    response point into `pool`; any not returned are appended in pool order."""
    docs = [c["content"] for c in pool]
    # The served model's hard limit is 512 tokens and vLLM REJECTS longer docs
    # (the local CrossEncoder silently truncated). truncate_prompt_tokens=512
    # restores that truncate-to-512 behavior -> comparable to the Band-A bge run.
    body = json.dumps({"model": MODEL, "query": query, "documents": docs,
                       "truncate_prompt_tokens": 512}).encode()
    hdr = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    last = ""
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(GATEWAY, data=body, headers=hdr)
            with urllib.request.urlopen(req, timeout=60) as r:
                results = json.loads(r.read())["results"]
            ranked = sorted(results, key=lambda x: -x["relevance_score"])
            seen, order = set(), []
            for x in ranked:
                i = x["index"]
                if 0 <= i < len(pool) and i not in seen:
                    seen.add(i)
                    order.append(pool[i]["memory_id"])
            for i, c in enumerate(pool):           # safety: any dropped idx, pool order
                if i not in seen:
                    order.append(c["memory_id"])
            return order
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, KeyError) as e:
            last = str(e)
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"scott rerank failed after {retries}: {last}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", default="/tmp/bandb-pools.json")
    ap.add_argument("--out", default="/tmp/bandb-orders.json")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    data = json.loads(Path(a.pools).read_text())
    queries = data["queries"]
    if a.limit:
        queries = queries[: a.limit]
    key = _key()
    print(f"  [bge/scott] {GATEWAY}  model={MODEL}  n={len(queries)}", file=sys.stderr)

    for i, q in enumerate(queries, 1):
        q["ids_A0"] = [c["memory_id"] for c in q["pool"]]
        q["ids_A1"] = rerank_order(q["query"], q["pool"], key) if q["pool"] else []
        if i % 25 == 0 or i == len(queries):
            print(f"  [bge/scott] {i}/{len(queries)}", file=sys.stderr)

    out = {
        "arms": ["A0", "A1"],
        "pool": data.get("pool"),
        "orders": [{k: q[k] for k in ("id", "kind", "band", "target", "target_in_pool",
                                      "target_pool_rank", "pool_size", "ids_A0", "ids_A1")
                    if k in q} for q in queries],
    }
    Path(a.out).write_text(json.dumps(out))
    print(f"\ndone: arms=['A0','A1'] (bge on scott)  {len(queries)} queries -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
