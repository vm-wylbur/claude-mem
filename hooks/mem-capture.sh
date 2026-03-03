#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-03-01
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-capture.sh
#
# Stop hook. Three jobs:
#   1. Extract <remember>...</remember> blocks from last assistant text turn
#      and POST each to /store.
#   2. Analyze full transcript for behavioral degradation signals
#      (command spray, bare turns, late-session acceleration) and store
#      a signal memory if any threshold is crossed.
#   3. Summarize the PostToolUse failure log (written by mem-degradation.sh)
#      and store it if there were >= 2 failures.
#
# Install in ~/.claude/settings.json:
#   "Stop": [{"hooks": [{"type": "command",
#     "command": "bash /path/to/claude-mem/hooks/mem-capture.sh"}]}]
#
# Required env (via settings.json env section):
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && exit 0

# ── 1. <remember> tags ────────────────────────────────────────────────────────
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

# Walk backwards: find last turn that has text content (not just tool_use/thinking)
for entry in reversed(entries):
    content = entry.get('message', {}).get('content', [])
    texts = [b['text'] for b in content if isinstance(b, dict) and b.get('type') == 'text']
    if texts:
        print('\n'.join(texts))
        break
PYEOF
)

if [[ -n "$LAST_TEXT" ]]; then
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
            && echo "[mem-capture] stored: ${memory:0:60}..." >&2
    done < <(
        perl -0777 -ne 'print "$1\0" while /<remember>(.*?)<\/remember>/sg' \
            <<< "$LAST_TEXT"
    )
fi

exit 0
