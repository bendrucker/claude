#!/bin/bash
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

cat "$(dirname "$0")/../references/guidelines.md"

if [ -n "$marker" ]; then
  touch "$marker"
fi
