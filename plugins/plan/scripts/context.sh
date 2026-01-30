#!/bin/bash
if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
  exit 0
fi

dir="/tmp/claude/${CLAUDE_SESSION_ID}"
mkdir -p "$dir"
marker="$dir/plan-injected"

mode=$(jq -r '.permission_mode // empty')
if [ "$mode" = "plan" ] && [ ! -f "$marker" ]; then
  cat "$(dirname "$0")/../references/guidelines.md"
  touch "$marker"
fi
