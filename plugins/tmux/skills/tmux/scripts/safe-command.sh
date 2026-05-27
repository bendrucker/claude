#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
pattern=$(jq -r 'join("|")' "$dir/../resources/safe-commands.json")

cat | jq --arg pattern "$pattern" '
  if (.tool_input.command | test("^tmux\\s+(" + $pattern + ")\\b"))
  then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: {dangerouslyDisableSandbox: true}}}
  else {hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {dangerouslyDisableSandbox: true}}}
  end'
