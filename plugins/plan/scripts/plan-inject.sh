#!/bin/bash
# PreToolUse injection: closes the gap where a session toggles into plan mode
# after its last prompt, so no UserPromptSubmit fires before ExitPlanMode.
# permission_mode rides on every PreToolUse, so the first tool call in plan mode
# is a reliable injection point. Shares the plan-injected marker with context.sh,
# so whichever fires first wins and the other short-circuits.
#
# EnterPlanMode is the other injection point. It carries the pre-switch mode, so
# a mode test alone would skip it, and a session that enters plan mode and writes
# the plan in the same turn reaches its next tool call only at ExitPlanMode, by
# which point the plan is already written.
input=$(cat)

mode=$(printf '%s' "$input" | jq -r '.permission_mode // empty')
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')
if [ "$mode" != "plan" ] && [ "$tool" != "EnterPlanMode" ]; then
  exit 0
fi

# PreToolUse fires on every tool call, so without a session_id to dedup against
# we would re-inject on each one. Require it here (context.sh, once per prompt,
# can afford to inject without dedup).
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')
if [ -z "$session_id" ]; then
  exit 0
fi

marker_root="${CLAUDE_PLAN_MARKER_ROOT:-/tmp/claude}"
dir="$marker_root/$session_id"
mkdir -p "$dir"
marker="$dir/plan-injected"
if [ -f "$marker" ]; then
  exit 0
fi

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
content=$("$(dirname "$0")/injection-content.sh" "$transcript")

jq -n --arg ctx "$content" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'

touch "$marker"
