# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bandb-classify.py
#
# Band-B Step 0 (spec §3 -- measure-first weighting). Mechanical, label-free
# classifier: flag each Band-A target memory as identifier-bearing if its
# content (or insight_title) carries a strong-identifier token, extract the
# token to FREEZE for the B2/B3 generation prompts, and report the fraction +
# per-pattern hit counts so the strata weighting is auditable. Precision need
# not be perfect (this is stratification, not ground truth) -- but the patterns
# are reported, per the spec.
#
# Two tiers: HARD identifiers (hex/sha runs, semver, crypto-algo tokens, model
# codes, config/env keys, fn-call names, paths/filenames, issue refs, CLI flags)
# drive the weights and B2/B3 eligibility. SOFT identifiers (fleet hostnames)
# are reported separately -- a paraphrase tends to keep a hostname, so it is a
# weak ejection anchor and is NOT used as a freeze token.
#
# A memory is B2/B3-ELIGIBLE only if a hard token appears verbatim in CONTENT
# (the B2 prompt feeds content + the token, then asserts the token survives).
#
# Inputs : eval/band_a.jsonl (target + query=insight_title)
#          /tmp/bandb-target-content.json (json_agg of memory_id+content, snowball)
# Output : /tmp/bandb-targets-classified.json  (per-target classification record)
#          stdout report (fraction, per-pattern counts, suggested weights)
#
# Usage:
#   uv run eval/bandb-classify.py \
#       [--content /tmp/bandb-target-content.json] [--out /tmp/bandb-targets-classified.json]

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# --- HARD identifier patterns (priority order = freeze-token preference) -------
# Each: (name, compiled regex). First match (by this order) becomes the freeze
# token for B2/B3. All matched in CONTENT for the token; content|title for the flag.
HARD = [
    ("hex",        re.compile(r"(?<![0-9a-zA-Z])(?=[0-9a-f]*[0-9])[0-9a-f]{7,}(?![0-9a-zA-Z])")),
    ("crypto",     re.compile(r"\b(?:ed25519|x25519|curve25519|mlkem\w*|secp256k1|rsa-?\d{2,4}|ecdsa|sha-?\d{2,3}|blake[23]?|aes-?\d{2,3}|ssh-ed25519)\b", re.I)),
    ("semver",     re.compile(r"(?<![\w.])\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*")),
    ("modelcode",  re.compile(r"\b[A-Z]{1,5}\d{2,}[A-Z0-9-]*\b")),
    ("configkey",  re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")),
    ("path",       re.compile(r"(?<![\w])(?:~|/)[\w.-]*(?:/[\w.-]+)+")),
    ("filename",   re.compile(r"\b[\w-]+\.(?:sql|py|ts|tsx|mjs|cjs|yaml|yml|md|service|conf|cfg|json|sh|toml|env)\b")),
    ("fncall",     re.compile(r"\b[a-z][a-z0-9_]*\(\)")),
    ("issueref",   re.compile(r"#\d+\b")),
    ("flag",       re.compile(r"(?<!\w)--[a-z][a-z0-9-]+\b")),
]

# --- SOFT identifiers (reported, not frozen): fleet hostnames -----------------
SOFT_HOSTS = re.compile(r"\b(?:snowball|scott|kj|kj-apis|porky|wylbur|vm-wylbur|bg-scott|tarak)\b", re.I)

# --- DISTINCTIVENESS FILTER (added 2026-06-07 after the source-doc audit) ------
# A HARD token can fire yet still be a USELESS B2 freeze anchor -- it identifies
# nothing distinctive about its memory, so a paraphrase keeps it by accident and
# B2 collapses into B1. The audit (27 eligible -> source docs) showed three junk
# classes, ALL evidence-grounded here:
#   - placeholders the source itself wrote OR the distiller injected:
#       /path/to/file, /dev/sdX, /dev/device  (generic device/path stand-ins)
#   - generic stdlib/ubiquitous calls: opendir(), stringify(), open() ...
#   - "hex" matches that are really plain DECIMAL numbers: 1048576 (=2^20),
#       4096000, 01010101 -- a true hash fragment carries an a-f letter.
# CLI flags were uniformly junk in the audit (--failed/--grep/--readonly/--reset),
# so `flag` is dropped from freeze eligibility wholesale (still reported).
# Distinctiveness is about token GENERICITY, NOT source-faithfulness -- a token
# that is distinctive but hallucinated (e.g. the vxa path) is still a valid B2
# anchor for ranking; its data-quality is a separate concern.
PLACEHOLDER_RX = re.compile(
    r"(?i)(?:^|/)(?:path/to/|dev/sd[xn]\b|dev/device\b|dev/sd$|output$|mnt/point\b)"
    r"|<[a-z][a-z0-9_]*>|\byour[-_]"
)
GENERIC_FNCALL = {
    "open()", "close()", "read()", "write()", "readdir()", "opendir()",
    "closedir()", "stringify()", "parse()", "print()", "println()", "printf()",
    "main()", "init()", "run()", "exit()", "len()", "str()", "repr()", "exec()",
}


def is_distinctive(name: str, tok: str) -> bool:
    """Is `tok` a usable B2 ejection anchor (distinctive), or generic junk?"""
    t = tok.strip()
    tl = t.lower()
    if PLACEHOLDER_RX.search(t):
        return False
    if name == "flag":                       # CLI flags are common across tools
        return False
    if name == "fncall" and tl in GENERIC_FNCALL:
        return False
    if name == "hex" and not re.search(r"[a-f]", tl):
        return False                         # pure-decimal: 1048576, 4096000, 01010101
    return True


def hard_tokens(text: str) -> dict:
    """{pattern_name: [matched tokens]} for every HARD pattern that fires."""
    out = {}
    for name, rx in HARD:
        ms = rx.findall(text)
        # findall on alternation groups can return tuples/empties; normalize
        ms = [m if isinstance(m, str) else next((x for x in m if x), "") for m in ms]
        ms = [m for m in ms if m]
        if ms:
            out[name] = ms
    return out


def pick_freeze(content_tokens: dict) -> tuple[str, str] | None:
    """First DISTINCTIVE hard token (by HARD priority order) present in CONTENT.
    Returns (pattern_name, token) or None. Generic junk (placeholders, stdlib
    calls, flags, pure-decimal "hex") is filtered by is_distinctive so it can't
    become a freeze anchor; within a pattern, prefer the longest surviving token
    (more distinctive => harder for a paraphraser to keep by accident)."""
    for name, _ in HARD:
        if name in content_tokens:
            cand = [t for t in content_tokens[name] if is_distinctive(name, t)]
            if cand:
                return name, max(cand, key=len)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--band-a", default="eval/band_a.jsonl")
    ap.add_argument("--content", default="/tmp/bandb-target-content.json")
    ap.add_argument("--out", default="/tmp/bandb-targets-classified.json")
    a = ap.parse_args()

    titles = {}
    actions = {}
    for line in Path(a.band_a).read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        titles[r["target"]] = r["query"]
        actions[r["target"]] = r.get("action", "")

    content_by_id = {m["memory_id"]: m["content"] for m in json.loads(Path(a.content).read_text())}

    recs = []
    pat_counts = Counter()       # memories with >=1 token of this pattern (content|title)
    freeze_pat_counts = Counter()
    n_hard = n_soft = n_eligible = n_content_hard = 0

    for tgt, title in titles.items():
        content = content_by_id.get(tgt, "")
        ct = hard_tokens(content)
        tt = hard_tokens(title)
        any_hard = bool(ct or tt)
        soft = bool(SOFT_HOSTS.search(content) or SOFT_HOSTS.search(title))
        freeze = pick_freeze(ct)            # must be a DISTINCTIVE token in CONTENT
        eligible = freeze is not None

        for name in set(ct) | set(tt):
            pat_counts[name] += 1
        if any_hard:
            n_hard += 1
        if ct:                              # had >=1 raw hard token in CONTENT
            n_content_hard += 1
        if soft:
            n_soft += 1
        if eligible:
            n_eligible += 1
            freeze_pat_counts[freeze[0]] += 1

        recs.append({
            "target": tgt,
            "title": title,
            "action": actions.get(tgt, ""),
            "content": content,
            "id_bearing_hard": any_hard,
            "id_bearing_soft": soft,
            "b23_eligible": eligible,
            "freeze_pattern": freeze[0] if freeze else None,
            "freeze_token": freeze[1] if freeze else None,
            "content_tokens": ct,
            "title_tokens": tt,
        })

    Path(a.out).write_text(json.dumps(recs))

    n = len(recs)
    efrac = n_eligible / n                   # DISTINCTIVE freezable fraction = real B2-eligible
    culled = n_content_hard - n_eligible     # had a content hard tok, but all generic junk
    print(f"\n  Band-B Step 0 -- identifier classification of {n} Band-A targets")
    print("  (distinctiveness filter ON: placeholders / stdlib calls / flags / pure-decimal hex culled)\n")
    print(f"  raw hard id-bearing (any pattern, content|title) : {n_hard}/{n}  ({n_hard/n:.1%})")
    print(f"  had a hard token in CONTENT                      : {n_content_hard}/{n}")
    print(f"    ... culled by distinctiveness (junk anchors)   : {culled}")
    print(f"  >> DISTINCTIVE B2/B3-eligible (freezable anchor)  : {n_eligible}/{n}  ({efrac:.1%})  <-- weighting key")
    print(f"  soft id-bearing (fleet hostname): {n_soft}/{n}  ({n_soft/n:.1%})  [reported, not frozen]\n")
    print("  per-pattern coverage (memories with >=1 such token, content|title):")
    for name, _ in HARD:
        print(f"    {name:<10} {pat_counts.get(name,0):>3}")
    print("\n  freeze-token pattern chosen (DISTINCTIVE B2/B3 eligible memories):")
    for name, _ in HARD:
        if freeze_pat_counts.get(name):
            print(f"    {name:<10} {freeze_pat_counts[name]:>3}")

    # spec §3 weighting rule, off the DISTINCTIVE eligible fraction (NOT raw hard --
    # raw overcounts: the audit showed 27 raw -> ~half were generic junk anchors).
    if efrac > 0.40:
        wt = "HIGH (>40%): B2+B3 main event -> B1 25% / B2 50% / B3 25%"
    elif efrac >= 0.15:
        wt = "MODERATE (15-40%): balanced -> B1 40% / B2 40% / B3 20%; oversample id-bearing in B2/B3"
    else:
        wt = "LOW (<15%): B1-dominant; FORCE a minimum B2 n (oversample all eligible) -> flag B2 verdict low-power"
    print(f"\n  spec §3 weighting (off DISTINCTIVE {efrac:.1%}) -> {wt}")
    print(f"\n  wrote {n} classified targets -> {a.out}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
