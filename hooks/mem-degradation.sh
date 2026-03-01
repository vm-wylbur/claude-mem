#!/usr/bin/env bash
# Author: PB and Claude
# Date: 2026-03-01
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# claude-mem/hooks/mem-degradation.sh
#
# PostToolUse hook: log Bash/Edit/Write tool failures to a per-session
# temp file. The Stop hook (mem-capture.sh) reads this log at session end
# and stores a summary if there were enough failures.
#
# This hook does NOT post to claude-mem directly — all persistence is
# owned by the Stop hook to keep signal quality high and avoid mid-session
# noise.
#
# Install in ~/.claude/settings.json:
#   "PostToolUse": [{"matcher": "Bash|Edit|Write", "hooks": [
#     {"type": "command", "timeout": 5,
#      "command": "bash /path/to/hooks/mem-degradation.sh"}]}]

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // ""')
TOOL_INPUT=$(echo "$INPUT" | jq -r \
    '.tool_input.command // .tool_input.file_path // .tool_input.old_string // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
PROJECT=$(basename "${CWD:-${CLAUDE_PROJECT_DIR:-$(pwd)}}")

[[ -z "$SESSION_ID" ]] && exit 0

case "$TOOL_NAME" in
    Bash|Edit|Write) ;;
    *) exit 0 ;;
esac

# Skip trivially short responses (empty grep output, etc.)
[[ ${#TOOL_RESPONSE} -lt 30 ]] && exit 0

# Detect failure via output content patterns
if ! echo "$TOOL_RESPONSE" | grep -qiE \
    "error:|Error:|ERROR:|failed|FAILED|Traceback|exception:|command not found|No such file|permission denied|syntax error|not found"; then
    exit 0
fi

# Append to per-session failure log
FAIL_LOG="/tmp/claude-deg-${SESSION_ID}.jsonl"
jq -n \
    --arg tool "$TOOL_NAME" \
    --arg input "${TOOL_INPUT:0:200}" \
    --arg response "${TOOL_RESPONSE: -400}" \
    --arg proj "$PROJECT" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{tool: $tool, input: $input, response: $response, project: $proj, ts: $ts}' \
    >> "$FAIL_LOG"

exit 0
