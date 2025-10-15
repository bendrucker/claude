#!/bin/bash

# PreToolUse hook to remind Claude of PR guidelines
# Checks transcript to avoid showing guidelines repeatedly

# Read JSON input
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
command=$(echo "$input" | jq -r '.tool_input.command // empty')
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

# Check if this is a PR-related tool
is_pr_tool=false

# Check Bash commands
if [[ "$tool_name" == "Bash" ]]; then
  if [[ "$command" =~ ^gh[[:space:]]+pr[[:space:]]+create ]] || \
     [[ "$command" =~ ^gh[[:space:]]+pr[[:space:]]+edit.*--body ]] || \
     [[ "$command" =~ ^glab[[:space:]]+mr[[:space:]]+create ]] || \
     [[ "$command" =~ ^glab[[:space:]]+mr[[:space:]]+update.*--description ]]; then
    is_pr_tool=true
  fi
fi

# Check MCP tools
if [[ "$tool_name" =~ ^mcp__github__(create|update)_pull_request$ ]]; then
  is_pr_tool=true
fi

# If not a PR tool, allow through silently
[[ "$is_pr_tool" == "false" ]] && exit 0

# Check if transcript exists
[[ ! -f "$transcript_path" ]] && exit 0

# Read guidelines file
script_dir="$(dirname "$0")"
guidelines_file="$script_dir/../../memory/tasks/pull-request.md"
[[ ! -f "$guidelines_file" ]] && exit 0

# Get the first line of guidelines as a marker
marker=$(head -n 1 "$guidelines_file")

# Check last 10 turns of transcript for guidelines marker
# Each turn is a JSON object on a single line
recent_turns=$(tail -n 10 "$transcript_path")

if echo "$recent_turns" | grep -qF "$marker"; then
  # Guidelines were shown recently, allow through
  exit 0
fi

# Guidelines not shown recently, output them to stderr and block
cat "$guidelines_file" >&2
exit 2
