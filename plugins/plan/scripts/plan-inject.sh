#!/bin/bash
# PreToolUse injection: closes the gap where a session toggles into plan mode
# after its last prompt, so no UserPromptSubmit fires before ExitPlanMode.
# permission_mode rides on every PreToolUse, so the first tool call in plan mode
# is a reliable injection point. Shares the plan-injected marker with context.sh,
# so whichever fires first wins and the other short-circuits.
input=$(cat)

mode=$(printf '%s' "$input" | jq -r '.permission_mode // empty')
if [ "$mode" != "plan" ]; then
  exit 0
fi

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')
marker_root="${CLAUDE_PLAN_MARKER_ROOT:-/tmp/claude}"

marker=""
if [ -n "$session_id" ]; then
  dir="$marker_root/$session_id"
  mkdir -p "$dir"
  marker="$dir/plan-injected"
  if [ -f "$marker" ]; then
    exit 0
  fi
fi

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
content=$("$(dirname "$0")/injection-content.sh" "$transcript")

jq -n --arg ctx "$content" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'

if [ -n "$marker" ]; then
  touch "$marker"
fi
