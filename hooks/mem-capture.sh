#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-02-28
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-capture.sh
#
# Stop hook: extract <remember>...</remember> blocks from the last assistant
# turn and POST them to the claude-mem /store REST endpoint.
#
# Install in ~/.claude/settings.json:
#   "Stop": [{"hooks": [{"type": "command",
#     "command": "bash /path/to/claude-mem/hooks/mem-capture.sh"}]}]
#
# Required env:
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

set -euo pipefail

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

# Read hook input from stdin
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && exit 0

# Get last assistant entry's text content (awk finds last matching line)
LAST_TEXT=$(
    awk '/"type"[[:space:]]*:[[:space:]]*"assistant"/{last=$0} END{print last}' \
        "$TRANSCRIPT_PATH" \
    | jq -r '.message.content[]? | select(.type == "text") | .text' 2>/dev/null \
    || true
)

[[ -z "$LAST_TEXT" ]] && exit 0

# Extract <remember>...</remember> blocks (perl handles multiline)
while IFS= read -r -d $'\0' memory; do
    memory=$(echo "$memory" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z "$memory" ]] && continue

    PAYLOAD=$(jq -n \
        --arg content "$memory" \
        --arg proj "$PROJECT" \
        '{content: $content, tags: [$proj]}')

    curl -sf -X POST "${ENDPOINT}/store" \
        -H "Content-Type: application/json" \
        -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
        -d "$PAYLOAD" \
        > /dev/null \
        && echo "[mem-capture] stored: ${memory:0:60}..." >&2 \
        || echo "[mem-capture] failed to store memory" >&2
done < <(
    perl -0777 -ne 'print "$1\0" while /<remember>(.*?)<\/remember>/sg' \
        <<< "$LAST_TEXT"
)

exit 0
