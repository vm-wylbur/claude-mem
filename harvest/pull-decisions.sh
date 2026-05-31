#!/usr/bin/env bash
# Author: PB and cc-dots 🧷
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# ---
# claude-mem/harvest/pull-decisions.sh
#
# Pull the extraction_decisions labeled set from the live claude_mem DB into a
# local JSONL fixture -- the distiller's seed (few-shot examples) and eval set
# (keep/skip regression). Reproducible; the output is gitignored, not committed,
# so PB's lesson content stays out of git history.
#
# Postgres on snowball is not network-exposed, so this goes over SSH + psql
# (same path the rest of the harvester uses).
#
# Usage:  harvest/pull-decisions.sh [output.jsonl]

set -euo pipefail

HOST="${CLAUDE_MEM_DB_SSH:-snowball}"
OUT="${1:-$(dirname "$0")/fixtures/extraction_decisions.jsonl}"
mkdir -p "$(dirname "$OUT")"

# Pull to a tempfile, validate, then atomically rename -- a dropped ssh, an
# auth failure, or a mid-stream psql error must leave the previous good fixture
# intact, never clobber it with an empty/partial/corrupt file. mktemp is 0600.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# -tA + row_to_json => one JSON object per line (JSONL). NOT `COPY ... TO STDOUT`,
# whose text-format backslash escaping mangles the JSON. --no-psqlrc avoids the
# user's .psqlrc chatter ("Pager usage is off.") leaking into stdout; -q quiets the rest.
ssh -o ConnectTimeout=10 "$HOST" \
    'psql --no-psqlrc -q -d claude_mem -tAc "SELECT row_to_json(e) FROM extraction_decisions e ORDER BY doc_filename, insight_number"' \
    > "$TMP"

# Fail closed before touching $OUT: non-empty, and every line valid JSON.
# `jq -e` exits nonzero on a parse error or empty input; a bare `jq` would
# exit 0 on a parse error and silently pass corruption through.
rows=$(wc -l < "$TMP" | tr -d ' ')
if [ "$rows" -eq 0 ]; then
    echo "ERROR: pull produced 0 rows; $OUT left unchanged" >&2; exit 1
fi
if ! jq -e . "$TMP" >/dev/null 2>&1; then
    echo "ERROR: pull produced invalid JSONL; $OUT left unchanged" >&2; exit 1
fi

mv "$TMP" "$OUT"
echo "wrote $rows rows -> $OUT"
echo "action breakdown:"
jq -r '.action' "$OUT" | sort | uniq -c
