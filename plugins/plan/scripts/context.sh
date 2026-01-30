#!/bin/bash
dir="/tmp/claude/${CLAUDE_SESSION_ID}"
mkdir -p "$dir"
marker="$dir/plan-injected"

mode=$(jq -r .permission_mode)
if [ "$mode" = "plan" ] && [ ! -f "$marker" ]; then
  cat "$(dirname "$0")/../references/guidelines.md"
  touch "$marker"
fi
