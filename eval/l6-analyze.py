# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-10
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/l6-analyze.py
#
# L6 (neg-6b0a3bf5, ledger item 3) stage 2: can the RRF top1-top2 score gap
# predict hit@1 well enough that the read-loop cascade reads the gap instead
# of waking bge?
#
# PRE-REGISTERED DECISION RULE (ratified, non-relitigable structure):
#   At the gap threshold achieving hit@1 recall >= 0.90, the 95% bootstrap
#   LOWER BOUND on precision must clear 0.70. AUC >= 0.80 is a secondary
#   screen only. Spearman dropped.
#
# Operationalization (implementation detail, reported for audit):
#   * predictor: flag "sufficient" when gap >= t. recall(t) = P(flag | hit1);
#     precision(t) = P(hit1 | flag). t* = the LARGEST t with recall >= 0.90
#     (max selectivity subject to the recall floor).
#   * bootstrap (B resamples over queries): primary variant RE-DERIVES t* in
#     each resample (accounts for threshold-selection variance); the
#     fixed-t* variant is reported as a sensitivity. PASS requires the
#     primary LB >= 0.70.
#   * AUC: Mann-Whitney over (gap, hit1).
#
# Usage:
#   uv run eval/l6-analyze.py /tmp/l6-gaps.json --boot 5000

import argparse
import json
import random
import sys
from pathlib import Path


def threshold_for_recall(pairs: list[tuple[float, bool]], floor: float) -> float | None:
    """Largest t with recall(t) >= floor. pairs = (gap, hit1)."""
    hits = sorted((g for g, h in pairs if h), reverse=True)
    if not hits:
        return None
    # recall >= floor  <=>  flag at least ceil(floor * n_hits) of the hits;
    # the largest such t is the gap of the ceil(floor*n)-th best hit.
    import math
    k = math.ceil(floor * len(hits))
    return hits[k - 1]


def precision_recall_at(pairs: list[tuple[float, bool]], t: float) -> tuple[float | None, float | None]:
    flagged = [h for g, h in pairs if g >= t]
    hits = [g for g, h in pairs if h]
    prec = (sum(flagged) / len(flagged)) if flagged else None
    rec = (sum(1 for g in hits if g >= t) / len(hits)) if hits else None
    return prec, rec


def auc(pairs: list[tuple[float, bool]]) -> float | None:
    pos = [g for g, h in pairs if h]
    neg = [g for g, h in pairs if not h]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gaps")
    ap.add_argument("--boot", type=int, default=5000)
    ap.add_argument("--recall-floor", type=float, default=0.90)
    ap.add_argument("--precision-bar", type=float, default=0.70)
    ap.add_argument("--seed", type=int, default=20260610)
    a = ap.parse_args()

    data = json.loads(Path(a.gaps).read_text())
    rows = [r for r in data["rows"] if r["gap"] is not None]
    dropped = data["n"] - len(rows)

    def report(label: str, sel: list[dict]) -> None:
        pairs = [(r["gap"], r["hit1"]) for r in sel]
        n_hit = sum(h for _, h in pairs)
        base = n_hit / len(pairs)
        t_star = threshold_for_recall(pairs, a.recall_floor)
        prec, rec = precision_recall_at(pairs, t_star) if t_star is not None else (None, None)
        a_uc = auc(pairs)

        rng = random.Random(a.seed)
        lb_re, lb_fix = None, None
        if t_star is not None and prec is not None:
            re_d, fix_d = [], []
            for _ in range(a.boot):
                s = [pairs[rng.randrange(len(pairs))] for _ in pairs]
                tb = threshold_for_recall(s, a.recall_floor)
                if tb is not None:
                    pb, _ = precision_recall_at(s, tb)
                    if pb is not None:
                        re_d.append(pb)
                pf, _ = precision_recall_at(s, t_star)
                if pf is not None:
                    fix_d.append(pf)
            re_d.sort(); fix_d.sort()
            lb_re = re_d[int(0.05 * len(re_d))] if re_d else None   # one-sided 95% LB
            lb_fix = fix_d[int(0.05 * len(fix_d))] if fix_d else None

        print(f"\n  {label}  (n={len(pairs)}, hit@1 base rate {base:.3f})")
        if t_star is None:
            print("    no hits -> no threshold; cell uninformative")
            return
        print(f"    t* (largest gap thresh w/ recall>={a.recall_floor:g}): {t_star:.6f}")
        print(f"    at t*: precision {prec:.3f}  recall {rec:.3f}  flagged {sum(1 for g,_ in pairs if g >= t_star)}/{len(pairs)}")
        print(f"    bootstrap 95% LB on precision: re-derived t {lb_re:.3f} | fixed t {lb_fix:.3f}")
        print(f"    AUC (secondary, bar 0.80): {a_uc:.3f}")
        if label == "OVERALL":
            verdict = "PASS" if (lb_re is not None and lb_re >= a.precision_bar) else "FAIL"
            print(f"\n  PRE-REGISTERED VERDICT: {verdict} "
                  f"(primary LB {lb_re:.3f} vs bar {a.precision_bar:g}; "
                  f"sensitivity fixed-t LB {lb_fix:.3f}; AUC {a_uc:.3f})")

    print(f"  L6 gap-vs-sufficiency  pool={data['pool']} k={data['rrf_k']} "
          f"boot={a.boot} dropped(no-gap)={dropped}")
    report("OVERALL", rows)
    for kind in sorted(set(r["kind"] for r in rows)):
        report(f"kind={kind}", [r for r in rows if r["kind"] == kind])
    return 0


if __name__ == "__main__":
    sys.exit(main())
