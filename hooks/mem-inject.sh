#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-03-02
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-inject.sh
#
# SessionStart hook: fetch recent project-specific memories and emit them
# to stdout so they appear as initial context at the start of each session.
# Only outputs if memories exist for this project (no-op otherwise).
#
# Install in ~/.claude/settings.json:
#   "SessionStart": [{"hooks": [{"type": "command",
#     "command": "bash /path/to/claude-mem/hooks/mem-inject.sh"}]}]
#
# Required env:
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

RESPONSE=$(curl -sf -X GET "${ENDPOINT}/recent?project=${PROJECT}&n=3" \
    -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
    2>/dev/null) || exit 0

[[ -z "$RESPONSE" ]] && exit 0

MEMORIES=$(echo "$RESPONSE" | jq -r '
    .memories[]? |
    "[\(.type // "unknown")] \(.content // "" | .[0:150])" +
    if (.tags | length) > 0 then "\nTags: \(.tags | join(", "))" else "" end +
    "\n"
' 2>/dev/null)

[[ -z "$MEMORIES" ]] && exit 0

echo "=== Recent memories from claude-mem ==="
echo "$MEMORIES"
