#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-02-28
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-inject.sh
#
# SessionStart hook: fetch recent memories and emit them to stdout so they
# appear as initial context at the start of each Claude Code session.
#
# Install in ~/.claude/settings.json:
#   "SessionStart": [{"hooks": [{"type": "command",
#     "command": "bash /path/to/claude-mem/hooks/mem-inject.sh"}]}]
#
# Required env:
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"

RESPONSE=$(curl -sf -X GET "${ENDPOINT}/recent?n=5" \
    -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
    2>/dev/null) || exit 0

[[ -z "$RESPONSE" ]] && exit 0

echo "=== Recent memories from claude-mem ==="
echo "$RESPONSE" | jq -r '
    .memories[]? |
    "[\(.type // "unknown")] \(.content // "" | .[0:300])" +
    if (.tags | length) > 0 then "\nTags: \(.tags | join(", "))" else "" end +
    "\n"
' 2>/dev/null || true
