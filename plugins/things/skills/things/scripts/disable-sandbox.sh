#!/bin/bash

# PreToolUse hook for Bash commands
# Disables sandbox for osascript and open commands (JXA requires cross-process IPC)

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Check if command starts with osascript or open
if [[ "$command" =~ ^(osascript|open)[[:space:]] ]]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: {
        dangerouslyDisableSandbox: true
      }
    }
  }'
fi
