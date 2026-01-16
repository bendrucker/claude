#!/bin/bash

# PreToolUse hook for osascript/open commands
# Disables sandbox because JXA requires cross-process IPC

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: {
      dangerouslyDisableSandbox: true
    }
  }
}'
