# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib"]
# ///
#
# Author: PB and Claude
# Date: 2026-06-10
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/l7-bge-look.py
#
# L7 exploratory stage 2: LOOK at the bge score distributions before fixing
# any threshold (PB's call 2026-06-10: "the scores we find are more important
# than specific thresholds"). Reports, per stratum and overall:
#   * top1 rerank_score distribution conditioned on hit@1 vs miss
#     (quantiles + histogram overlay),
#   * bge top1-top2 margin, same conditioning,
#   * AUC with bootstrap CI for both signals,
#   * the operating curve (precision/recall as the top1-score threshold
#     sweeps) so candidate operating points can be read off the data.
# Saves a two-panel figure next to the findings docs.
#
# Usage:
#   uv run eval/l7-bge-look.py /tmp/l7-bge-scores.json \
#       --fig ~/docs/claude-mem/l7-bge-score-look-20260610.png

import argparse
import json
import random
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def quantiles(xs: list[float]) -> str:
    if not xs:
        return "(empty)"
    s = sorted(xs)
    q = lambda p: s[min(int(p * len(s)), len(s) - 1)]
    return (f"n={len(s)}  min={s[0]:.3f}  p10={q(.10):.3f}  p25={q(.25):.3f}  "
            f"p50={q(.50):.3f}  p75={q(.75):.3f}  p90={q(.90):.3f}  max={s[-1]:.3f}")


def auc_ci(pos: list[float], neg: list[float], boot: int, rng: random.Random) -> tuple[float, float, float]:
    def auc(p, n):
        if not p or not n:
            return float("nan")
        wins = sum((x > y) + 0.5 * (x == y) for x in p for y in n)
        return wins / (len(p) * len(n))
    point = auc(pos, neg)
    ds = []
    for _ in range(boot):
        pb = [pos[rng.randrange(len(pos))] for _ in pos]
        nb = [neg[rng.randrange(len(neg))] for _ in neg]
        ds.append(auc(pb, nb))
    ds.sort()
    return point, ds[int(0.025 * boot)], ds[min(int(0.975 * boot), boot - 1)]


def operating_curve(pairs: list[tuple[float, bool]]) -> list[tuple[float, float, float, int]]:
    """(threshold, precision, recall, n_flagged) at each distinct score."""
    out = []
    n_hits = sum(h for _, h in pairs)
    for t in sorted({g for g, _ in pairs}, reverse=True):
        flagged = [(g, h) for g, h in pairs if g >= t]
        tp = sum(h for _, h in flagged)
        out.append((t, tp / len(flagged), tp / n_hits if n_hits else 0.0, len(flagged)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("scores")
    ap.add_argument("--fig", default=None)
    ap.add_argument("--boot", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=20260610)
    a = ap.parse_args()
    rng = random.Random(a.seed)

    data = json.loads(Path(a.scores).read_text())
    rows = [r for r in data["rows"]
            if r["rerank_scores"] and r["rerank_scores"][0] is not None]
    dropped = data["n"] - len(rows)

    def signals(r):
        s = [x for x in r["rerank_scores"] if x is not None]
        top1 = s[0]
        margin = (s[0] - s[1]) if len(s) >= 2 else None
        return top1, margin

    print(f"  L7 bge-score look  n={len(rows)} (dropped no-score: {dropped})  "
          f"path={data['path']}")

    for label, sel in [("OVERALL", rows)] + [
            (f"kind={k}", [r for r in rows if r["kind"] == k])
            for k in sorted(set(r["kind"] for r in rows))]:
        hit_top1 = [signals(r)[0] for r in sel if r["hit1"]]
        miss_top1 = [signals(r)[0] for r in sel if not r["hit1"]]
        hit_m = [m for r in sel if r["hit1"] and (m := signals(r)[1]) is not None]
        miss_m = [m for r in sel if not r["hit1"] and (m := signals(r)[1]) is not None]

        print(f"\n  {label}  (hit@1 {len(hit_top1)}/{len(sel)} = {len(hit_top1)/len(sel):.3f})")
        print(f"    top1 score | hit : {quantiles(hit_top1)}")
        print(f"    top1 score | miss: {quantiles(miss_top1)}")
        if hit_top1 and miss_top1:
            pt, lo, hi = auc_ci(hit_top1, miss_top1, a.boot, rng)
            print(f"    AUC(top1)  = {pt:.3f}  [{lo:.3f}, {hi:.3f}]")
        if hit_m and miss_m:
            pt, lo, hi = auc_ci(hit_m, miss_m, a.boot, rng)
            print(f"    AUC(margin)= {pt:.3f}  [{lo:.3f}, {hi:.3f}]")

    # overall operating curve on top1 score: print a readable slice
    pairs = [(signals(r)[0], r["hit1"]) for r in rows]
    curve = operating_curve(pairs)
    print("\n  OPERATING CURVE (top1 score threshold -> precision / recall / flagged):")
    print(f"    {'thresh':>8} {'prec':>6} {'recall':>7} {'flagged':>8}")
    shown = set()
    for t, p, rcl, n in curve:
        key = round(rcl, 1)
        if key not in shown:
            shown.add(key)
            print(f"    {t:>8.3f} {p:>6.3f} {rcl:>7.3f} {n:>5}/{len(pairs)}")

    if a.fig:
        fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
        hit = [signals(r)[0] for r in rows if r["hit1"]]
        miss = [signals(r)[0] for r in rows if not r["hit1"]]
        bins = [i / 20 for i in range(21)]
        axes[0].hist(miss, bins=bins, alpha=0.55, label=f"miss (n={len(miss)})", color="#c44")
        axes[0].hist(hit, bins=bins, alpha=0.55, label=f"hit@1 (n={len(hit)})", color="#2a7")
        axes[0].set_xlabel("bge top1 rerank_score")
        axes[0].set_ylabel("queries")
        axes[0].set_title("top1 score by hit@1 outcome (173 Band-B)")
        axes[0].legend()
        rc = [(rcl, p) for _, p, rcl, _ in curve]
        axes[1].plot([r for r, _ in rc], [p for _, p in rc], marker=".", lw=1)
        axes[1].set_xlabel("recall (of true hit@1s kept)")
        axes[1].set_ylabel("precision among flagged")
        axes[1].set_title("operating curve: threshold on top1 score")
        axes[1].grid(True, alpha=0.3)
        fig.tight_layout()
        out = Path(a.fig).expanduser()
        fig.savefig(out, dpi=130)
        print(f"\n  figure -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
