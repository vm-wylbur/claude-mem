# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bandb-generate.py
#
# Band-B generation (spec §4). Model-generated, NO hand-labeling: each query's
# target memory_id is INHERITED from its Band-A parent (the human-provenance
# label), and only the QUERY side is rewritten. Generator = kj/gemma4-31b-it
# (OpenAI-compatible at http://kj/llm/v1). Reads the distinctiveness-filtered
# Step-0 output; emits a bakeoff-queries jsonl the existing harness consumes
# (kind = the stratum, so bakeoff-analyze.py stratifies per cell for free).
#
# Strata (LOW regime per Step 0 -- B1-dominant, B2/B3 oversample ALL 14 eligible,
# B2 flagged low-power downstream):
#   B1  oblique-frame, NO identifier   -- sampled across the 95 targets
#   B2  oblique-frame, FREEZE the anchor verbatim (THE ejection cell) -- 14 elig
#   B3  identifier-dominant            -- 14 elig
#
# Mechanical guards (the only thing stopping B2 from silently collapsing into B1):
#   B2/B3 -> assert freeze_token verbatim in every kept query; regen the call up
#           to --retries; if still short, keep what survived and LOG the shortfall.
#   B1    -> when the target is identifier-bearing, assert the freeze_token is
#           ABSENT (no leak); drop+regen leaks. Dedup near-identical per target.
#
# Usage:
#   uv run eval/bandb-generate.py --out /tmp/bandb-queries.jsonl \
#       [--k 3] [--b1-n 30] [--retries 3] [--temp 0.7] [--limit N] [--strata B1,B2,B3]

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

KJ_URL = "http://kj/llm/v1/chat/completions"
MODEL = "gemma4-31b-it"


def _key() -> str:
    """Optional bearer (kj gateway is open today, but honor the hrdag api key if
    present -- same surface eval.py uses)."""
    try:
        for ln in Path.home().joinpath(".config/hrdag/api").read_text().splitlines():
            if ln.startswith("API_KEY="):
                return ln.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


def chat(prompt: str, temp: float, key: str, retries: int = 3) -> str:
    body = {"model": MODEL, "messages": [{"role": "user", "content": prompt}],
            "temperature": temp, "max_tokens": 220}
    hdr = {"Content-Type": "application/json"}
    if key:
        hdr["Authorization"] = f"Bearer {key}"
    last = ""
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(KJ_URL, data=json.dumps(body).encode(), headers=hdr)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())["choices"][0]["message"]["content"]
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = str(e)
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"kj chat failed after {retries}: {last}")


def parse_lines(text: str) -> list[str]:
    """One query per line; strip bullets/numbering/quotes; drop preamble lines."""
    out = []
    for ln in text.splitlines():
        s = ln.strip().lstrip("-*•").strip()
        s = s.lstrip("0123456789.").strip().strip('"').strip("`").strip()
        if not s:
            continue
        low = s.lower()
        if low.startswith(("here are", "here's", "sure", "okay", "queries:", "search quer")):
            continue
        out.append(s)
    return out


def dedup(qs: list[str]) -> list[str]:
    seen, out = set(), []
    for q in qs:
        k = " ".join(q.lower().split())
        if k not in seen:
            seen.add(k)
            out.append(q)
    return out


B1_TMPL = (
    "Here is a stored technical note: «{content}». Write {k} short SEARCH QUERIES "
    "(the kind you type into a search box, not questions to a person) someone might "
    "type months later when they half-remember this and are looking for it again. "
    "Use everyday, describe-the-SYMPTOM language. Do NOT use any of the note's "
    "distinctive technical terms, version numbers, identifiers, product names, file "
    "names, or jargon -- describe the situation, not the keywords. "
    "Output ONLY the {k} queries, one per line, no numbering, no preamble."
)
B2_TMPL = (
    "Here is a stored technical note: «{content}». It contains this exact identifier: "
    "«{tok}». Write {k} short SEARCH QUERIES (typed into a search box, not questions) "
    "someone might use months later to find this note again. Rewrite the surrounding "
    "description in different, more casual words -- but keep the identifier «{tok}» "
    "exactly as written, character-for-character, in each query. Do not paraphrase or "
    "explain the identifier. Output ONLY the {k} queries, one per line, no numbering, "
    "no preamble."
)
B3_TMPL = (
    "Here is a stored technical note containing the identifier «{tok}»: «{content}». "
    "Write {k} TERSE search queries that center on «{tok}» with minimal extra words -- "
    "the way someone greps their memory for a specific code. Keep «{tok}» verbatim in "
    "each. Output ONLY the {k} queries, one per line, no numbering, no preamble."
)


def gen_for(rec: dict, stratum: str, k: int, temp: float, key: str, retries: int) -> tuple[list[str], str]:
    """Return (queries, note). Enforces the per-stratum anchor guard with regen."""
    content = rec["content"][:1100]
    tok = rec.get("freeze_token")
    if stratum == "B1":
        prompt = B1_TMPL.format(content=content, k=k)
        must_have, must_absent = None, (tok if rec["b23_eligible"] else None)
    elif stratum == "B2":
        prompt = B2_TMPL.format(content=content, tok=tok, k=k)
        must_have, must_absent = tok, None
    else:  # B3
        prompt = B3_TMPL.format(content=content, tok=tok, k=k)
        must_have, must_absent = tok, None

    kept: list[str] = []
    for attempt in range(1, retries + 1):
        qs = parse_lines(chat(prompt, temp, key, retries))
        for q in qs:
            if must_have and must_have not in q:
                continue                       # dropped the anchor -> discard
            if must_absent and must_absent in q:
                continue                       # leaked the identifier -> discard
            kept.append(q)
        kept = dedup(kept)
        if len(kept) >= k:
            return kept[:k], ""
        time.sleep(0.3)
    note = f"SHORT n={len(kept)}/{k}" + (f" (anchor {must_have!r})" if must_have else "")
    return kept[:k], note


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--classified", default="/tmp/bandb-targets-classified.json")
    ap.add_argument("--out", default="/tmp/bandb-queries.jsonl")
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--b1-n", type=int, default=30)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--temp", type=float, default=0.7)
    ap.add_argument("--limit", type=int, default=0, help="smoke: first N targets per stratum")
    ap.add_argument("--strata", default="B1,B2,B3")
    a = ap.parse_args()

    recs = json.loads(Path(a.classified).read_text())
    eligible = [r for r in recs if r["b23_eligible"]]
    # B1: deterministic stride sample across ALL targets (reproducible, no rng).
    ordered = sorted(recs, key=lambda r: r["target"])
    step = max(1, len(ordered) // a.b1_n)
    b1_targets = ordered[::step][:a.b1_n]
    plan = {"B1": b1_targets, "B2": eligible, "B3": eligible}
    strata = [s for s in a.strata.split(",") if s in plan]
    key = _key()

    print(f"  Band-B generate | model={MODEL} k={a.k} retries={a.retries} temp={a.temp}", file=sys.stderr)
    print(f"  plan: " + "  ".join(f"{s}={len(plan[s])}" for s in strata)
          + f"  (auth={'bearer' if key else 'none'})", file=sys.stderr)

    rows, n_short = [], 0
    for stratum in strata:
        tgts = plan[stratum][: a.limit] if a.limit else plan[stratum]
        for i, rec in enumerate(tgts, 1):
            qs, note = gen_for(rec, stratum, a.k, a.temp, key, a.retries)
            if note:
                n_short += 1
                print(f"    ! {stratum} {rec['target']} {note}", file=sys.stderr)
            for v, q in enumerate(qs, 1):
                rows.append({
                    "id": f"bb-{stratum}-{rec['target']}-{v}",
                    "kind": stratum, "band": "B", "target": rec["target"],
                    "query": q, "variant": v,
                    "freeze_token": rec.get("freeze_token") if stratum != "B1" else None,
                })
            if i % 10 == 0 or i == len(tgts):
                print(f"    [{stratum}] {i}/{len(tgts)}  queries={sum(r['kind']==stratum for r in rows)}",
                      file=sys.stderr)

    Path(a.out).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    per = {s: sum(r["kind"] == s for r in rows) for s in strata}
    print(f"\ndone: {len(rows)} queries -> {a.out}")
    print(f"  per stratum: " + "  ".join(f"{s}={per[s]}" for s in strata) + f"  short-cells={n_short}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
