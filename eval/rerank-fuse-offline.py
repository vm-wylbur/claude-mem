# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/rerank-fuse-offline.py
#
# THROWAWAY analysis companion to rerank-probe.py. Reads the per-query
# ORDERED id lists dumped by `rerank-probe.py --dump-orders` (one expensive
# rerank pass) and evaluates many GUARD variants OFFLINE -- no model reload,
# no snowball hit. The question it answers: which fusion of bge-rerank-order
# with hybrid-order maximizes MRR while holding recall@5 == 1.00 (so a strong
# lexical hit like id_ed25519 can't be demoted out of the window)?
#
# Variants:
#   - hybrid        : live search_hybrid order (baseline)
#   - bge_alone     : cross-encoder order, no guard
#   - rrf_sym k     : symmetric Reciprocal Rank Fusion, score = 1/(k+rh)+1/(k+rr)
#   - rrf_wtd wr:wh : weighted RRF, score = wr/(k+rr) + wh/(k+rh) (favor rerank)
#   - pin_floor P   : protect hybrid top-P -> force them into the first P slots
#                     (ordered among themselves by rerank), everything else by rerank
#
# Pure stdlib, deterministic, reads only the dump file. Trust the printed
# table because every number is recomputed here from the raw ordered lists.
#
# Usage:
#   uv run eval/rerank-fuse-offline.py /tmp/probe-orders.json

import json
import statistics
import sys
from pathlib import Path

KINDS = ["exact-id", "id-topic", "conceptual"]


def rank_of(target, ids):
    for i, mid in enumerate(ids, 1):
        if mid == target:
            return i
    return None


def order_hybrid(o):
    return o["ids_before"]


def order_bge(o):
    return o["ids_after"]


def order_rrf(o, k, wr=1.0, wh=1.0):
    rh = {m: i for i, m in enumerate(o["ids_before"], 1)}
    rr = {m: i for i, m in enumerate(o["ids_after"], 1)}
    ids = set(rh) | set(rr)
    big = len(ids) + k

    def sc(m):
        return wr / (k + rr.get(m, big)) + wh / (k + rh.get(m, big))

    # tie-break on hybrid rank for determinism (matches probe's rrf_fuse).
    return sorted(ids, key=lambda m: (-sc(m), rh.get(m, big)))


def order_pin(o, P):
    """Force hybrid top-P docs into the first P slots (ordered among
    themselves by rerank rank); everything else follows in rerank order."""
    protect = set(o["ids_before"][:P])
    rr_order = o["ids_after"]
    top = [m for m in rr_order if m in protect]          # protected, by rerank
    rest = [m for m in rr_order if m not in protect]     # remainder, by rerank
    return top + rest


def metrics(orders, order_fn):
    ranks = [rank_of(o["target"], order_fn(o)) for o in orders]
    kinds = [o["kind"] for o in orders]

    def agg(sel):
        rs = [r for r, kept in zip(ranks, sel) if kept]
        n = len(rs)
        if not n:
            return (0, 0.0, 0.0, 0.0)
        r5 = sum(bool(r and r <= 5) for r in rs) / n
        r10 = sum(bool(r and r <= 10) for r in rs) / n
        mrr = statistics.mean(1.0 / r if r else 0.0 for r in rs)
        return (n, r5, r10, mrr)

    out = {"ALL": agg([True] * len(orders))}
    for k in KINDS:
        out[k] = agg([kk == k for kk in kinds])
    # worst gold rank (how far out of the window the worst case sits)
    out["worst"] = max((r or 9999) for r in ranks)
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: rerank-fuse-offline.py <dump.json>", file=sys.stderr)
        return 2
    dump = json.loads(Path(sys.argv[1]).read_text())
    orders = dump["orders"]

    variants = [
        ("hybrid", lambda o: order_hybrid(o)),
        ("bge_alone", lambda o: order_bge(o)),
    ]
    for k in (10, 20, 30, 40, 60, 100, 150, 200):
        variants.append((f"rrf_sym k={k}", (lambda k: lambda o: order_rrf(o, k))(k)))
    for (wr, wh) in ((2, 1), (3, 1), (5, 1)):
        for k in (30, 60):
            variants.append(
                (f"rrf_wtd {wr}:{wh} k={k}",
                 (lambda wr, wh, k: lambda o: order_rrf(o, k, wr, wh))(wr, wh, k))
            )
    for P in (2, 3, 4):
        variants.append((f"pin_floor P={P}", (lambda P: lambda o: order_pin(o, P))(P)))

    print(f"\n  n={len(orders)}  model={dump.get('model')}  pool={dump.get('pool')}\n")
    hdr = f"  {'variant':<18} {'r@5':>5} {'r@10':>5} {'MRR':>6} {'worst':>5}   {'r@5/MRR by kind (exact-id|id-topic|conceptual)'}"
    print(hdr)
    print("  " + "-" * (len(hdr) + 18))
    rows = []
    for name, fn in variants:
        m = metrics(orders, fn)
        n, r5, r10, mrr = m["ALL"]
        bykind = "  ".join(
            f"{k.split('-')[0][:4]}:{m[k][1]:.2f}/{m[k][3]:.2f}" for k in KINDS
        )
        flag = "  <== r@5=1.00" if r5 >= 1.0 else ""
        print(f"  {name:<18} {r5:>5.2f} {r10:>5.2f} {mrr:>6.3f} {m['worst']:>5}   {bykind}{flag}")
        rows.append({"variant": name, "recall@5": round(r5, 4), "recall@10": round(r10, 4),
                     "mrr": round(mrr, 4), "worst": m["worst"]})

    # winner = highest MRR among variants holding recall@5 == 1.00
    safe = [r for r in rows if r["recall@5"] >= 1.0]
    if safe:
        best = max(safe, key=lambda r: r["mrr"])
        print(f"\n  WINNER (max MRR s.t. recall@5==1.00): {best['variant']}  "
              f"MRR={best['mrr']:.3f}  recall@5={best['recall@5']:.2f}  worst={best['worst']}")
    else:
        print("\n  NO variant holds recall@5 == 1.00")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
