#!/bin/bash
# Injection on a tool event, from two hooks.json entries: PreToolUse with
# matcher * closes the gap where a session toggles into plan mode after its last
# prompt, so no UserPromptSubmit fires before ExitPlanMode. PostToolUse with
# matcher EnterPlanMode covers the session that researches in auto mode and then
# writes the plan in one turn, whose next tool call is ExitPlanMode itself.
#
# permission_mode is the gate for the PreToolUse entry. The PostToolUse entry
# needs no mode test: EnterPlanMode carries the pre-switch mode before it runs,
# and reaching PostToolUse at all means it landed. Gating on the event keeps the
# marker off a call the user interrupted, which would otherwise silence both
# paths for the rest of the session.
#
# Shares the plan-injected marker with context.sh, so whichever fires first wins
# and the other short-circuits.
input=$(cat)

# The PreToolUse entry has to keep matcher * (no matcher expresses "whichever
# tool comes first in plan mode"), so this runs on every tool call in every
# session. Test the raw payload before spawning jq, so a call outside plan mode
# exits without the parse. Loose substring matches, so a payload that merely
# mentions the word falls through and the checks below decide as before.
case "$input" in
  *PostToolUse*) ;;
  *'"permission_mode"'*'"plan"'*) ;;
  *) exit 0 ;;
esac

# Unit separator, not tab: tab is IFS whitespace, so `read` would collapse a run
# of empty fields and shift every value left of the first absent key.
IFS=$'\037' read -r event mode agent_id session_id transcript < <(
  printf '%s' "$input" | jq -j '
    [.hook_event_name, .permission_mode, .agent_id, .session_id, .transcript_path]
    | map(. // "") | join("\u001f"), "\n"'
)
event="${event:-PreToolUse}"
if [ "$event" != "PostToolUse" ] && [ "$mode" != "plan" ]; then
  exit 0
fi

# A subagent's tool call carries the parent's session_id, so injecting here would
# spend the parent's marker on context only the subagent sees.
if [ -n "$agent_id" ]; then
  exit 0
fi

# PreToolUse fires on every tool call, so without a session_id to dedup against
# we would re-inject on each one. Require it here (context.sh, once per prompt,
# can afford to inject without dedup).
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

content=$("$(dirname "$0")/injection-content.sh" "$transcript")

jq -n --arg event "$event" --arg ctx "$content" \
  '{hookSpecificOutput: {hookEventName: $event, additionalContext: $ctx}}'

touch "$marker"
