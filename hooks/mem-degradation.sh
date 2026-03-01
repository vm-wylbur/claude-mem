#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-03-01
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-degradation.sh
#
# PostToolUse hook: track Bash/Edit/Write tool failures as degradation signals.
# Logs failures to a per-session temp file; posts a signal to claude-mem when
# failures accumulate, so degraded sessions are detectable later.
#
# Install in ~/.claude/settings.json:
#   "PostToolUse": [{"matcher": "Bash|Edit|Write", "hooks": [{"type": "command",
#     "command": "bash /path/to/hooks/mem-degradation.sh"}]}]
#
# Required env (available via settings.json env section):
#   CLAUDE_MEM_SECRET   shared secret for the HTTP endpoint
#   CLAUDE_MEM_URL      base URL (default: http://snowball:3456)

ENDPOINT="${CLAUDE_MEM_URL:-http://snowball:3456}"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // ""')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input.command // .tool_input.file_path // .tool_input.old_string // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
PROJECT=$(basename "${CWD:-${CLAUDE_PROJECT_DIR:-$(pwd)}}")

[[ -z "$SESSION_ID" ]] && exit 0

# Only track these tools
case "$TOOL_NAME" in
    Bash|Edit|Write) ;;
    *) exit 0 ;;
esac

# Skip trivially short output (e.g. grep returning empty)
[[ ${#TOOL_RESPONSE} -lt 30 ]] && exit 0

# Detect failure via output content — same patterns OMC uses
if ! echo "$TOOL_RESPONSE" | grep -qiE \
    "error:|Error:|ERROR:|failed|FAILED|Traceback|exception:|command not found|No such file|permission denied|syntax error|undefined|not found"; then
    exit 0
fi

# Append this failure to per-session log
FAIL_LOG="/tmp/claude-deg-${SESSION_ID}.jsonl"
jq -n \
    --arg tool "$TOOL_NAME" \
    --arg input "${TOOL_INPUT:0:200}" \
    --arg response "${TOOL_RESPONSE: -400}" \
    --arg proj "$PROJECT" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{tool: $tool, input: $input, response: $response, project: $proj, ts: $ts}' \
    >> "$FAIL_LOG"

FAIL_COUNT=$(wc -l < "$FAIL_LOG" 2>/dev/null | tr -d ' ')

# Post a live signal at failure thresholds (3, 6, 9, ...)
if (( FAIL_COUNT >= 3 && FAIL_COUNT % 3 == 0 )); then
    SUMMARY=$(jq -rs 'map("[\(.ts)] \(.tool): \(.input | .[0:80])") | join("\n")' "$FAIL_LOG" 2>/dev/null || echo "(log unreadable)")
    PAYLOAD=$(jq -n \
        --arg content "Degradation signal: ${FAIL_COUNT} tool failures in session ${SESSION_ID}

Project: ${PROJECT}

Failures:
${SUMMARY}" \
        --arg proj "$PROJECT" \
        '{content: $content, tags: ["degraded-session", "tool-failure", $proj]}')

    curl -sf -X POST "${ENDPOINT}/store" \
        -H "Content-Type: application/json" \
        -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
        -d "$PAYLOAD" \
        > /dev/null \
        && echo "[mem-degradation] stored signal at ${FAIL_COUNT} failures" >&2 \
        || echo "[mem-degradation] failed to POST signal" >&2
fi

exit 0
