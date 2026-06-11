# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-11
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/b1-demotion-audit.py
#
# B1 demotion audit (roadmap §8 step 1): before optimizing the reranker
# against hit@1, resize the yardstick. For each B1 query where the labeled
# target is NOT served top-1, an LLM judge (gemma on kj, temperature 0)
# answers: does the SERVED top-1 satisfy the query's information need as
# well as the labeled target? Cases split:
#   acceptable  - served top-1 answers the need (sibling/alternative; the
#                 "miss" is label noise, not a ranking failure)
#   partial     - related but materially worse than the target
#   wrong       - the served result does not answer the need
# Reported separately for DEMOTED queries (target outside served top-10)
# vs RANKED-2-10 (target served, just not first).
#
# Inputs: the L7 live-path pull (ids + ranks) + content fetched read-only
# from snowball. Judge calls go to http://kj/llm/v1 (OpenAI-compatible).
#
# Usage:
#   uv run eval/b1-demotion-audit.py \
#       --scores ~/docs/claude-mem/bandb-run-20260607/l7-bge-scores-20260610.json \
#       --out /tmp/b1-audit.json

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

KJ = "http://kj/llm/v1/chat/completions"
MODEL = "gemma4-31b-it"
BEARER = next(l.split("=", 1)[1].strip() for l in (Path.home() / ".config/hrdag/api").read_text().splitlines()
              if l.startswith("API_KEY="))

# The L7 pull predates migration 005 (id padding) and the legacy-id cleanup:
# normalize short hex ids by zero-padding; map the two decimal-era rows the
# cleanup migrated to canonical hash ids.
MIGRATED = {
    "5126259141766117873": "47242187839179f1",
    "10215528874082477558": "8dc4d963046ea5f6",
    "826d2412aefb8ad5670f2a180daf8ac409f219a2c2f96e564c4a64cba665c327": "b33955d8fb13ffe8",
}


def canon(mid: str) -> str:
    if mid in MIGRATED:
        return MIGRATED[mid]
    if re.fullmatch(r"[0-9a-f]{1,15}", mid):
        return mid.zfill(16)
    return mid

PROMPT = """You are auditing a memory-retrieval system for a technical team. A user issued a vague, oblique query. The system served CANDIDATE as its top result. The dataset labels TARGET as the correct answer, but labels can be stale: the store may contain several memories about the same incident, and an alternative can answer the need equally well.

QUERY: {query}

TARGET (labeled correct answer):
{target}

CANDIDATE (what the system served first):
{candidate}

Judge ONLY whether CANDIDATE satisfies the information need expressed by QUERY as well as TARGET does. Reply with a single JSON object, no other text:
{{"verdict": "acceptable" | "partial" | "wrong", "reason": "<one sentence>"}}"""


def fetch_contents(ids: list[str]) -> dict[str, str]:
    sql = ("SELECT json_agg(t) FROM (SELECT memory_id, content FROM memories WHERE memory_id IN ("
           + ",".join(f"'{i}'" for i in sorted(set(ids))) + ")) t;")
    out = subprocess.run(["ssh", "-o", "BatchMode=yes", "snowball", "psql -d claude_mem -qAt -f -"],
                         input=sql, capture_output=True, text=True, timeout=120).stdout
    # json_agg puts NEWLINES between array elements, so line-filtering shears
    # the payload. Parse the whole blob from the first '[' (psql noise like
    # "Pager usage is off." precedes it and contains no bracket).
    rows = json.loads(out[out.index("["):])
    return {r["memory_id"]: r["content"] for r in rows}


def judge(query: str, target: str, candidate: str) -> dict:
    body = json.dumps({
        "model": MODEL, "temperature": 0, "max_tokens": 200,
        "messages": [{"role": "user", "content": PROMPT.format(
            query=query, target=target[:4000], candidate=candidate[:4000])}],
    }).encode()
    req = urllib.request.Request(KJ, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {BEARER}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        text = json.loads(r.read())["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    data = json.loads(Path(a.scores).expanduser().read_text())
    b1 = [r for r in data["rows"] if r["kind"] == "B1"]
    misses = [r for r in b1 if r["target_rank"] != 1 and r["ids"]]
    print(f"B1 queries: {len(b1)}; top-1 misses to audit: {len(misses)}", file=sys.stderr)

    need = [canon(r["target"]) for r in misses] + [canon(r["ids"][0]) for r in misses]
    content = fetch_contents(need)

    out_rows, t0 = [], time.time()
    for i, r in enumerate(misses, 1):
        served_id = canon(r["ids"][0])
        tgt, cand = content.get(canon(r["target"])), content.get(served_id)
        if tgt is None or cand is None:
            out_rows.append({**{k: r[k] for k in ("id", "query", "target", "target_rank")},
                             "served": served_id, "verdict": "fetch-failed", "reason": ""})
            continue
        try:
            v = judge(r["query"], tgt, cand)
        except Exception as e:
            v = {"verdict": "judge-error", "reason": str(e)[:120]}
        out_rows.append({
            "id": r["id"], "query": r["query"], "target": r["target"],
            "target_rank": r["target_rank"], "served": served_id,
            "group": "demoted" if (r["target_rank"] is None or r["target_rank"] > 10) else "rank-2-10",
            "verdict": v.get("verdict", "judge-error"), "reason": v.get("reason", ""),
        })
        if i % 10 == 0:
            print(f"  {i}/{len(misses)} ({time.time()-t0:.0f}s)", file=sys.stderr)

    Path(a.out).write_text(json.dumps({"model": MODEL, "n": len(out_rows), "rows": out_rows}, indent=1))

    from collections import Counter
    for grp in ("demoted", "rank-2-10"):
        sel = [r for r in out_rows if r.get("group") == grp]
        c = Counter(r["verdict"] for r in sel)
        print(f"\n  {grp} (n={len(sel)}): {dict(c)}")
    overall = Counter(r["verdict"] for r in out_rows)
    print(f"  ALL (n={len(out_rows)}): {dict(overall)}")
    acc = overall.get("acceptable", 0)
    print(f"\n  label-noise estimate: {acc}/{len(out_rows)} of B1 'misses' have an acceptable served answer")
    print(f"  honest B1 top-1 quality ~= ({sum(1 for r in b1 if r['target_rank']==1)} + {acc}) / {len(b1)} "
          f"= {(sum(1 for r in b1 if r['target_rank']==1) + acc)/len(b1):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
