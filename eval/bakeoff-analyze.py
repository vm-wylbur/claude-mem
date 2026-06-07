# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-07
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/bakeoff-analyze.py
#
# Stage 3 of the rerank-slot bake-off. Pure stdlib, no snowball/model: reads
# the per-query ordered id lists from bakeoff-score.py and reports, per arm:
# recall@{1,5,10} + MRR, overall and stratified by band (A / golden) and kind
# (exact-id / id-topic / conceptual / known-item). Then the decision rows:
# the paired deltas A1-A0, A2-A0, A2-A1 with 95% paired-bootstrap CIs (all arms
# score the SAME queries, so the comparison is paired -- resample queries, not
# arms). Reports the pool-containment ceiling: every arm's recall is capped by
# whether the target is in the pool at all, so a low score can be a candidate-
# gen miss rather than a rerank miss.
#
# Usage:
#   uv run eval/bakeoff-analyze.py /tmp/bakeoff-orders.json [--boot 2000]

import argparse
import json
import random
import statistics
import sys
from pathlib import Path

METRICS = ["r@1", "r@5", "r@10", "mrr"]
_KEY = {"r@1": "h1", "r@5": "h5", "r@10": "h10", "mrr": "rr"}


def rank_of(target, ids):
    for i, m in enumerate(ids, 1):
        if m == target:
            return i
    return None


def per_query(orders, arm):
    """Aligned per-query metric values for one arm, or None if arm absent."""
    key = "ids_" + arm
    if not all(key in o for o in orders):
        return None
    rows = []
    for o in orders:
        r = rank_of(o["target"], o[key])
        rows.append({
            "kind": o["kind"], "band": o["band"],
            "h1": float(bool(r and r <= 1)), "h5": float(bool(r and r <= 5)),
            "h10": float(bool(r and r <= 10)), "rr": (1.0 / r if r else 0.0),
        })
    return rows


def agg(rows):
    n = len(rows)
    if not n:
        return None
    return {"n": n,
            "r@1": sum(x["h1"] for x in rows) / n,
            "r@5": sum(x["h5"] for x in rows) / n,
            "r@10": sum(x["h10"] for x in rows) / n,
            "mrr": statistics.mean(x["rr"] for x in rows)}


def boot_delta(va, vb, B, seed=42):
    """Paired bootstrap of mean(vb)-mean(va): resample query indices."""
    n = len(va)
    rng = random.Random(seed)
    point = sum(vb) / n - sum(va) / n
    ds = []
    for _ in range(B):
        s = [rng.randrange(n) for _ in range(n)]
        ds.append(sum(vb[i] for i in s) / n - sum(va[i] for i in s) / n)
    ds.sort()
    return point, ds[int(0.025 * B)], ds[min(int(0.975 * B), B - 1)]


def strat_table(title, arms, pq, predicate):
    sel = [i for i, o in enumerate(pq[arms[0]]) if predicate(o)]
    if not sel:
        return
    print(f"\n  {title}  (n={len(sel)})")
    print(f"  {'arm':<4} {'r@1':>6} {'r@5':>6} {'r@10':>6} {'MRR':>7}")
    for arm in arms:
        rows = [pq[arm][i] for i in sel]
        a = agg(rows)
        print(f"  {arm:<4} {a['r@1']:>6.3f} {a['r@5']:>6.3f} {a['r@10']:>6.3f} {a['mrr']:>7.4f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("orders")
    ap.add_argument("--boot", type=int, default=2000)
    a = ap.parse_args()

    data = json.loads(Path(a.orders).read_text())
    orders = data["orders"]
    present = [arm for arm in ("A0", "A1", "A2") if per_query(orders, arm) is not None]
    pq = {arm: per_query(orders, arm) for arm in present}

    label = {"A0": "A0 hybrid", "A1": "A1 bge", "A2": "A2 colbert"}
    print(f"\n  bake-off: arms={[label[a] for a in present]}  n={len(orders)}  pool={data.get('pool')}  boot={a.boot}")

    # pool-containment ceiling (cap on every arm's recall)
    cont = sum(o.get("target_in_pool", True) for o in orders)
    print(f"  pool-containment ceiling: {cont}/{len(orders)} ({cont/len(orders):.1%}) "
          f"-- recall cannot exceed this; below it is a candidate-gen miss, not a rerank miss")

    strat_table("OVERALL", present, pq, lambda o: True)
    for band in sorted(set(o["band"] for o in orders)):
        strat_table(f"band={band}", present, pq, (lambda b: lambda o: o["band"] == b)(band))
    for kind in sorted(set(o["kind"] for o in orders)):
        strat_table(f"kind={kind}", present, pq, (lambda k: lambda o: o["kind"] == k)(kind))

    # decision rows: paired deltas with bootstrap CIs
    pairs = [(x, y) for x, y in (("A1", "A0"), ("A2", "A0"), ("A2", "A1")) if x in pq and y in pq]
    if pairs:
        print(f"\n  === paired deltas (Δ = later - earlier; 95% paired-bootstrap CI over {len(orders)} queries) ===")
        print(f"  {'delta':<10} {'metric':<6} {'Δ':>8}  {'95% CI':>18}  sig")
        for hi, lo in pairs:
            for metric in METRICS:
                va = [r[_KEY[metric]] for r in pq[lo]]
                vb = [r[_KEY[metric]] for r in pq[hi]]
                d, cl, ch = boot_delta(va, vb, a.boot)
                sig = "*" if (cl > 0 or ch < 0) else " "
                print(f"  {hi}-{lo:<7} {metric:<6} {d:>+8.4f}  [{cl:>+7.4f},{ch:>+7.4f}]  {sig}")
        print("  (* = 95% CI excludes 0)")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
