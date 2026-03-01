#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-02-28
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-precompact.sh
#
# PreCompact hook: fetch recent memories and emit them to stdout so they are
# prepended to the compacted context, preserving continuity across compactions.
#
# Install in ~/.claude/settings.json:
#   "PreCompact": [{"hooks": [{"type": "command",
#     "command": "bash /path/to/claude-mem/hooks/mem-precompact.sh"}]}]
#
# Required env:
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"

RESPONSE=$(curl -sf -X GET "${ENDPOINT}/recent?n=5" \
    -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
    2>/dev/null) || exit 0

[[ -z "$RESPONSE" ]] && exit 0

echo "=== Recent memories (claude-mem, pre-compaction) ==="
echo "$RESPONSE" | jq -r '
    .memories[]? |
    "[\(.type // "unknown")] \(.content // "" | .[0:300])" +
    if (.tags | length) > 0 then "\nTags: \(.tags | join(", "))" else "" end +
    "\n"
' 2>/dev/null || true
