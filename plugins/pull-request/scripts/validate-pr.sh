#!/bin/bash

# PreToolUse hook to validate PR body content
# Blocks PR creation if test counts are mentioned

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

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

body_file=""
if [[ "$command" =~ --body-file[[:space:]]+([^[:space:]]+) ]]; then
  body_file="${BASH_REMATCH[1]}"
elif [[ "$command" =~ --body-file=([^[:space:]]+) ]]; then
  body_file="${BASH_REMATCH[1]}"
fi

[[ -z "$body_file" ]] && exit 0
[[ ! -f "$body_file" ]] && exit 0

body=$(cat "$body_file")

if echo "$body" | grep -qiE '[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests'; then
  output_json "deny" "Testing section should not mention test counts. Describe what is covered instead."
  exit 0
fi

exit 0
