#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
pattern=$(paste -sd '|' "$dir/safe-commands.txt")

cat | jq --arg pattern "$pattern" '
  if (.tool_input.command | test("^tmux\\s+(" + $pattern + ")\\b"))
  then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}
  else {hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}
  end'
