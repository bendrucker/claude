#!/bin/bash

# PreToolUse hook to intercept wasteful GitHub HTML fetches
# Returns JSON with efficient gh CLI alternatives

# Read JSON input and extract URL
input=$(cat)
url=$(echo "$input" | jq -r '.tool_input.url // empty')

# Only process GitHub URLs
[[ ! "$url" =~ ^https://github\.com/ ]] && exit 0

# Helper function to output JSON response
output_json() {
  local decision="$1"
  local reason="$2"
  jq -n \
    --arg decision "$decision" \
    --arg reason "$reason" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: $decision,
        permissionDecisionReason: $reason
      }
    }'
}

# Parse GitHub URL patterns and deny with efficient alternatives
if [[ "$url" =~ github\.com/([^/]+)/([^/]+) ]]; then
  # Repository root - get README
  if [[ "$url" =~ ^https://github\.com/[^/]+/[^/]+/?$ ]]; then
    output_json "deny" "Use: gh repo view [<repository>]"
    exit 0
  fi

  # Files/directories
  if [[ "$url" =~ /blob/([^/]+)/(.+)$ ]] || [[ "$url" =~ /tree/([^/]+)/?(.*)$ ]]; then
    output_json "deny" "Use: mcp__github__get_file_contents"
    exit 0
  fi

  # Issue/PR - gh automatically detects repo context
  if [[ "$url" =~ /(issues|pull)/([0-9]+)$ ]]; then
    type="${BASH_REMATCH[1]}"
    if [[ "$type" == "issues" ]]; then
      output_json "deny" "Use: mcp__github__get_issue"
    else
      output_json "deny" "Use: mcp__github__get_pull_request"
    fi
    exit 0
  fi
fi

# Unknown GitHub URL pattern - ask user
output_json "ask" "Unknown GitHub URL pattern. Consider using gh CLI or GitHub MCP tools."
exit 0
