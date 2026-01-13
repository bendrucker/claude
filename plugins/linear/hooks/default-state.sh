#!/bin/bash

# PreToolUse hook for mcp__linear__create_issue
# Sets default state based on assignee when state is not specified

input=$(cat)
state=$(echo "$input" | jq -r '.tool_input.state // empty')

# Only modify if state is not set
if [[ -n "$state" ]]; then
  exit 0
fi

assignee=$(echo "$input" | jq -r '.tool_input.assignee // empty')

if [[ -n "$assignee" ]]; then
  default_state="Todo"
else
  default_state="Backlog"
fi

jq -n \
  --arg state "$default_state" \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: {
        state: $state
      }
    }
  }'
