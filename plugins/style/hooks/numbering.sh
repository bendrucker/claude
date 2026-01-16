#!/bin/bash

# PreToolUse hook to detect numbered patterns
# - Code files: ast-grep for numbered identifiers
# - Markdown files: remark for numbered headings
#
# Usage: numbering.sh <mode>
# Modes:
#   write - Block files with numbered patterns (deny)
#   edit  - Warn about numbered patterns being added (ask)

set -euo pipefail

mode="${1:-write}"
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')

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

# Determine file type
ext="${file_path##*.}"
plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"

# Output denial/ask response
output_response() {
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

# Check Markdown files with remark
check_markdown() {
  local content="$1"

  # Run the check script via npx (installs deps on first run, cached after)
  local result
  result=$(npx -y -p mdast-util-from-markdown@2 -p unist-util-visit@5 node "$plugin_dir/scripts/check-markdown-headings.js" "$content" 2>/dev/null || true)

  if [[ -n "$result" && "$result" != "[]" ]]; then
    local first_match
    first_match=$(echo "$result" | jq -r '.[0].text // "Numbered heading detected"')
    echo "Numbered heading: $first_match"
  fi
}

# Check code files with ast-grep
check_code() {
  local content="$1"
  local ext="$2"

  # Skip if sg not available
  if ! command -v sg &> /dev/null; then
    return
  fi

  # Create temp file with correct extension
  local tmp_file="${TMPDIR:-/tmp}/hook-check.${ext}"
  echo "$content" > "$tmp_file"

  # Run ast-grep
  local rule_file="$(dirname "$0")/numbering.yml"
  local result
  result=$(sg scan --rule "$rule_file" --json "$tmp_file" 2>/dev/null || true)

  rm -f "$tmp_file"

  # Check for matches
  local match_count
  match_count=$(echo "$result" | jq 'length' 2>/dev/null || echo "0")

  if [[ "$match_count" -gt 0 ]]; then
    local first_message
    first_message=$(echo "$result" | jq -r '.[0].message // "Numbered identifier detected"')
    echo "$first_message"
  fi
}

# Run appropriate check based on file type
case "$ext" in
  md|markdown)
    match=$(check_markdown "$content")
    ;;
  *)
    # Let ast-grep auto-detect language from extension
    match=$(check_code "$content" "$ext")
    ;;
esac

# Output response if match found
if [[ -n "$match" ]]; then
  reason="Detected numbered sequences that create tight coupling.
$match

Use descriptive names instead. See CLAUDE.md Organization guidelines."

  if [[ "$mode" == "write" ]]; then
    output_response "deny" "$reason"
  else
    output_response "ask" "This edit introduces numbered sequences. $reason"
  fi
fi
