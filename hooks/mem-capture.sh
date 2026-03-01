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

# ── 2. Behavioral metrics ─────────────────────────────────────────────────────
METRICS=$(python3 - "$TRANSCRIPT_PATH" <<'PYEOF'
import sys, json

entries = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            e = json.loads(line)
            if e.get('type') == 'assistant':
                entries.append(e)
        except Exception:
            pass

turns = []
for e in entries:
    content = e.get('message', {}).get('content', [])
    text_chars = sum(
        len(b.get('text', ''))
        for b in content
        if isinstance(b, dict) and b.get('type') == 'text'
    )
    tool_count = sum(
        1 for b in content
        if isinstance(b, dict) and b.get('type') == 'tool_use'
    )
    # Skip empty/progress-only entries
    if tool_count > 0 or text_chars > 50:
        turns.append({'text_chars': text_chars, 'tool_count': tool_count})

if len(turns) < 5:
    print(json.dumps({'skip': True, 'reason': 'too_short', 'turn_count': len(turns)}))
    sys.exit(0)

total_tools  = sum(t['tool_count'] for t in turns)
total_turns  = len(turns)
with_tools   = [t for t in turns if t['tool_count'] > 0]

avg_tools    = total_tools / max(len(with_tools), 1)
bare         = sum(1 for t in turns if t['tool_count'] >= 2 and t['text_chars'] < 100)
bare_frac    = bare / total_turns

third        = max(total_turns // 3, 1)
first_avg    = sum(t['tool_count'] for t in turns[:third])  / third
last_avg     = sum(t['tool_count'] for t in turns[-third:]) / third
accel_ratio  = last_avg / max(first_avg, 0.1)

signals = []
if avg_tools    > 5:   signals.append(f'command_spray: {avg_tools:.1f} tools/turn avg')
if bare_frac    > 0.35: signals.append(f'bare_turns: {bare_frac:.0%} of turns lack reasoning text')
if accel_ratio  > 1.8: signals.append(f'acceleration: last-third {last_avg:.1f} vs first-third {first_avg:.1f} tools/turn')

print(json.dumps({
    'skip':               False,
    'turn_count':         total_turns,
    'total_tools':        total_tools,
    'avg_tools_per_turn': round(avg_tools,   2),
    'bare_turn_fraction': round(bare_frac,   2),
    'acceleration_ratio': round(accel_ratio, 2),
    'signals':            signals,
}))
PYEOF
)

SKIP=$(echo "$METRICS"    | jq -r '.skip    // true')
N_SIG=$(echo "$METRICS"   | jq -r '.signals | length')

if [[ "$SKIP" == "false" && "$N_SIG" -gt 0 ]]; then
    SIG_LIST=$(echo "$METRICS" | jq -r '.signals | join(", ")')
    TURNS=$(echo "$METRICS"    | jq -r '.turn_count')
    TOOLS=$(echo "$METRICS"    | jq -r '.total_tools')
    AVG=$(echo "$METRICS"      | jq -r '.avg_tools_per_turn')
    ACCEL=$(echo "$METRICS"    | jq -r '.acceleration_ratio')
    BARE=$(echo "$METRICS"     | jq -r '.bare_turn_fraction')

    PAYLOAD=$(jq -n \
        --arg content "Behavioral degradation signals at session end

Project: ${PROJECT}
Session: ${SESSION_ID}

Signals: ${SIG_LIST}

Metrics:
  turns=${TURNS}, total_tools=${TOOLS}
  avg_tools/turn=${AVG}, bare_turn_fraction=${BARE}, accel_ratio=${ACCEL}" \
        --arg proj "$PROJECT" \
        '{content: $content, tags: ["degraded-session", "behavioral-metrics", $proj]}')

    curl -sf -X POST "${ENDPOINT}/store" \
        -H "Content-Type: application/json" \
        -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
        -d "$PAYLOAD" \
        > /dev/null \
        && echo "[mem-capture] stored behavioral metrics (${N_SIG} signals)" >&2
fi

# ── 3. Tool failure summary ───────────────────────────────────────────────────
if [[ -n "$SESSION_ID" ]]; then
    FAIL_LOG="/tmp/claude-deg-${SESSION_ID}.jsonl"
    if [[ -f "$FAIL_LOG" ]]; then
        FAIL_COUNT=$(wc -l < "$FAIL_LOG" | tr -d ' ')
        if (( FAIL_COUNT >= 2 )); then
            SUMMARY=$(jq -rs \
                'map("[\(.ts)] \(.tool): \(.input | .[0:80])") | join("\n")' \
                "$FAIL_LOG" 2>/dev/null || echo "(unreadable)")
            PAYLOAD=$(jq -n \
                --arg content "Tool failure summary: ${FAIL_COUNT} failures at session end
Project: ${PROJECT}
Session: ${SESSION_ID}

${SUMMARY}" \
                --arg proj "$PROJECT" \
                '{content: $content, tags: ["degraded-session", "tool-failures", $proj]}')
            curl -sf -X POST "${ENDPOINT}/store" \
                -H "Content-Type: application/json" \
                -H "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET:-}" \
                -d "$PAYLOAD" \
                > /dev/null \
                && echo "[mem-capture] stored failure summary (${FAIL_COUNT} failures)" >&2
        fi
        rm -f "$FAIL_LOG"
    fi
fi

exit 0
