# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Author: PB and Claude
# Date: 2026-06-11
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/scripts/backfill-doc-path-metadata.py
#
# One-shot, dry-run-by-default: normalize lessons_learned_docs.metadata by
# re-parsing the stored filepath (format `host:/abs/path/file.md`). The newer
# doc-watcher already writes {host, repo, root, category, real_path, size};
# most rows predate it (junk like {"word_count": 1} or {}). The filepath
# column makes the backfill fully retroactive — no filesystem access.
#
# Derived keys: host, real_path, root, repo, category
# (incident|lesson|archive|repo-doc|doc), doc_date (ISO, from filename).
# MERGE POLICY: existing metadata wins on key conflicts — derived values only
# fill gaps (jsonb `derived || existing`), so watcher-written rows are never
# clobbered and re-running is idempotent.
#
# Usage:
#   uv run scripts/backfill-doc-path-metadata.py            # dry-run report
#   uv run scripts/backfill-doc-path-metadata.py --apply    # write (gated)

import argparse
import json
import re
import subprocess
import sys
from collections import Counter

PSQL = ["ssh", "-o", "BatchMode=yes", "snowball", "psql -d claude_mem -q -tA -f -"]

ORG_DIRS = {"hrdag", "personal"}  # projects/<org>/<repo>/... vs projects/<repo>/...


def parse_path(filepath: str) -> dict:
    m = re.match(r"^([a-z0-9_-]+):(/.*)$", filepath)
    host, real = (m.group(1), m.group(2)) if m else (None, filepath)
    parts = real.split("/")

    repo = None
    if "projects" in parts:
        i = parts.index("projects")
        tail = parts[i + 1:]
        if len(tail) >= 2 and tail[0] in ORG_DIRS:
            repo = tail[1]
        elif tail:
            repo = tail[0]

    low = real.lower()
    if "/incidents/" in low:
        category = "incident"
    elif "/lessons/" in low or "lessons-learned" in low or "lessons_learned" in low:
        category = "lesson"
    elif "/archive/" in low:
        category = "archive"
    elif repo and "/docs/" in low:
        category = "repo-doc"
    else:
        category = "doc"

    root = None
    if "/docs/" in real:
        root = real[: real.index("/docs/") + len("/docs")]
    elif real.endswith("/docs"):
        root = real

    fname = parts[-1]
    dm = re.search(r"(\d{4})-(\d{2})-(\d{2})", fname) or re.search(r"(\d{4})(\d{2})(\d{2})", fname)
    doc_date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}" if dm else None

    out = {"real_path": real, "category": category}
    if host: out["host"] = host
    if repo: out["repo"] = repo
    if root: out["root"] = root
    if doc_date: out["doc_date"] = doc_date
    return out


def run_sql(sql: str) -> str:
    proc = subprocess.run(PSQL, input=sql, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr[:400]}")
    return proc.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the merged metadata (default: dry-run)")
    ap.add_argument("--samples", type=int, default=20)
    a = ap.parse_args()

    rows = []
    out = run_sql("SELECT json_agg(t) FROM (SELECT doc_id, filepath, metadata FROM lessons_learned_docs) t;")
    rows = json.loads(out.strip())

    derived = {r["doc_id"]: parse_path(r["filepath"]) for r in rows}

    cat = Counter(d["category"] for d in derived.values())
    host = Counter(d.get("host", "(none)") for d in derived.values())
    repo = Counter(d.get("repo", "(none)") for d in derived.values())
    dated = sum(1 for d in derived.values() if "doc_date" in d)
    already_rich = sum(1 for r in rows if isinstance(r["metadata"], dict) and "host" in r["metadata"])

    print(f"docs: {len(rows)}  | already-rich (watcher-format, untouched keys): {already_rich}")
    print(f"with parsed doc_date: {dated}")
    print(f"category: {dict(cat.most_common())}")
    print(f"host:     {dict(host.most_common())}")
    print(f"repo:     {dict(repo.most_common(12))}")
    print(f"\nsample parses (first {a.samples}):")
    for r in rows[: a.samples]:
        print(f"  {r['filepath'][:80]}")
        print(f"    -> {json.dumps(derived[r['doc_id']])}")

    if not a.apply:
        print("\nDRY-RUN: no writes. Re-run with --apply to merge (existing keys win).")
        return 0

    # Apply: one UPDATE per row via a single VALUES join; existing metadata
    # wins (derived || existing).
    values = ",".join(
        "({},{})".format(
            "$q${}$q$".format(doc_id),
            "$j${}$j$".format(json.dumps(d)),
        )
        for doc_id, d in derived.items()
    )
    sql = (
        "UPDATE lessons_learned_docs l SET metadata = v.derived::jsonb || COALESCE(l.metadata, '{}'::jsonb) "
        f"FROM (VALUES {values}) AS v(doc_id, derived) WHERE l.doc_id = v.doc_id;"
    )
    out = run_sql("\\set ON_ERROR_STOP on\nBEGIN;\n" + sql + "\nCOMMIT;\nSELECT 'updated';")
    print("\nAPPLIED:", out.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
