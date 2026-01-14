#!/bin/bash

# PreToolUse hook to detect numbered identifiers using ast-grep
# Usage: numbering.sh <mode>
# Modes:
#   write - Block files with numbered patterns (deny)
#   edit  - Warn about numbered patterns being added (ask)

set -euo pipefail

mode="${1:-write}"
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')

# Check if sg is available
if ! command -v sg &> /dev/null; then
  # Graceful skip - don't break workflow if sg isn't installed
  exit 0
fi

# Extract content and file path based on tool type
if [[ "$tool_name" == "Write" ]]; then
  content=$(echo "$input" | jq -r '.tool_input.content // empty')
  file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
elif [[ "$tool_name" == "Edit" ]]; then
  content=$(echo "$input" | jq -r '.tool_input.new_string // empty')
  file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
else
  exit 0
fi

# Skip if no content
[[ -z "$content" ]] && exit 0

# Determine extension and skip unsupported languages
ext="${file_path##*.}"
case "$ext" in
  go|js|jsx|mjs|cjs|ts|tsx|mts|cts|py) ;;
  *) exit 0 ;;
esac

# Create temp file with correct extension for language detection
tmp_file="${TMPDIR:-/tmp}/hook-check.${ext}"
echo "$content" > "$tmp_file"

# Run ast-grep on the temp file
rule_file="$(dirname "$0")/numbering.yml"
result=$(sg scan --rule "$rule_file" --json "$tmp_file" 2>/dev/null || true)

# Clean up
rm -f "$tmp_file"

# Check if any matches found (result is already a JSON array)
match_count=$(echo "$result" | jq 'length' 2>/dev/null || echo "0")

if [[ "$match_count" -gt 0 ]]; then
  # Extract first match message for the reason
  first_message=$(echo "$result" | jq -r '.[0].message // "Numbered identifier detected"')

  reason="Detected numbered sequences that create tight coupling.
$first_message

Use descriptive names instead. See CLAUDE.md Organization guidelines."

  if [[ "$mode" == "write" ]]; then
    jq -n \
      --arg reason "$reason" \
      '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
  else
    jq -n \
      --arg reason "This edit introduces numbered sequences. $reason" \
      '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: $reason
        }
      }'
  fi
fi
