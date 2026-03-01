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

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

# Read hook input from stdin
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && exit 0

# Get last assistant entry's text content using python3 for reliable JSON parsing.
# (awk/grep matching is unreliable — "assistant" appears nested in progress entries.)
LAST_TEXT=$(python3 - "$TRANSCRIPT_PATH" <<'PYEOF'
import sys, json

entries = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
            if e.get('type') == 'assistant':
                entries.append(e)
        except Exception:
            pass

if not entries:
    sys.exit(0)

# Walk backwards to find last entry with actual text content
for entry in reversed(entries):
    content = entry.get('message', {}).get('content', [])
    texts = [b['text'] for b in content if isinstance(b, dict) and b.get('type') == 'text']
    if texts:
        print('\n'.join(texts))
        break
PYEOF
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

# Check for degradation log from this session; store a summary if enough failures.
if [[ -n "$SESSION_ID" ]]; then
    FAIL_LOG="/tmp/claude-deg-${SESSION_ID}.jsonl"
    if [[ -f "$FAIL_LOG" ]]; then
        FAIL_COUNT=$(wc -l < "$FAIL_LOG" | tr -d ' ')
        if (( FAIL_COUNT >= 2 )); then
            SUMMARY=$(jq -rs 'map("[\(.ts)] \(.tool): \(.input | .[0:80])") | join("\n")' "$FAIL_LOG" 2>/dev/null || echo "(unreadable)")
            PAYLOAD=$(jq -n \
                --arg content "Degraded session at Stop: ${FAIL_COUNT} tool failures
Project: ${PROJECT}
Session: ${SESSION_ID}

Failures:
${SUMMARY}" \
                --arg proj "$PROJECT" \
                '{content: $content, tags: ["degraded-session", "session-summary", $proj]}')
            curl -sf -X POST "${ENDPOINT}/store" \
                -H "Content-Type: application/json" \
                -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
                -d "$PAYLOAD" \
                > /dev/null \
                && echo "[mem-capture] stored degradation summary (${FAIL_COUNT} failures)" >&2
        fi
        rm -f "$FAIL_LOG"
    fi
fi

exit 0
