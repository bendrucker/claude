#!/bin/bash
set -euo pipefail

# Context usage measurement and reporting for Claude Code
# Measures baseline context consumption from configuration (CLAUDE.md, MCP servers, etc.)

usage() {
  cat <<EOF
Usage: $0 <command> [options]

Commands:
  check [file]  Parse /context output and return JSON
                Reads from file, stdin, or runs /context interactively
  report [file] Generate GitHub Flavored Markdown table from JSON
                Reads JSON from file or stdin

Examples:
  # Interactive (will prompt you to paste /context output)
  $0 check

  # From file
  $0 check tmp/context-output.txt > tmp/context.json

  # From stdin
  claude --print --verbose '/context' | $0 check > tmp/context.json

  # Generate report
  $0 check | $0 report
  $0 report tmp/context.json

  # Combined
  $0 check tmp/context-output.txt | $0 report
EOF
  exit 1
}

check() {
  local output
  local input_file="${1:-}"
  local tmpfile

  # Read input from file, stdin, or run claude command
  if [ -n "$input_file" ]; then
    # From file argument
    if [ ! -f "$input_file" ]; then
      echo "Error: File not found: $input_file" >&2
      exit 1
    fi
    output=$(cat "$input_file")
  elif [ ! -t 0 ]; then
    # From stdin (not a terminal)
    tmpfile=$(mktemp)
    trap "rm -f $tmpfile" EXIT
    cat > "$tmpfile"

    # Check if stdin was JSON output from claude --output-format json
    if jq -e '.[1].message.content' "$tmpfile" >/dev/null 2>&1; then
      # Extract text from <local-command-stdout> in message content
      output=$(jq -r '.[1].message.content' "$tmpfile" | awk '/<local-command-stdout>/{flag=1;next}/<\/local-command-stdout>/{flag=0}flag')
    elif jq -e '.messages' "$tmpfile" >/dev/null 2>&1; then
      # Fallback: older JSON format
      output=$(jq -r '.messages[] | select(.role == "assistant") | .content[]? | select(.type == "text") | .text' "$tmpfile")
    else
      # Plain text
      output=$(cat "$tmpfile")
    fi
  else
    # Run claude command directly
    tmpfile=$(mktemp)
    trap "rm -f $tmpfile" EXIT

    if ! timeout 30 claude --print '/context' --output-format json --verbose 2>/dev/null > "$tmpfile"; then
      echo "Error: Failed to run 'claude --print /context'" >&2
      echo "Try providing the output as a file or via stdin" >&2
      exit 1
    fi

    # Extract text from <local-command-stdout> in message content
    output=$(jq -r '.[1].message.content' "$tmpfile" | awk '/<local-command-stdout>/{flag=1;next}/<\/local-command-stdout>/{flag=0}flag')
  fi

  # Extract model and token info from first line after "Context Usage"
  # Example: "claude-sonnet-4-5-20250929 • 143k/200k tokens (72%)"
  local model total_used total_capacity percentage

  if echo "$output" | grep -q "tokens"; then
    model=$(echo "$output" | grep -oE 'claude-[a-z0-9-]+' | head -1)
    total_used=$(echo "$output" | grep -oE '[0-9.]+k/[0-9.]+k tokens' | head -1 | cut -d/ -f1)
    total_capacity=$(echo "$output" | grep -oE '[0-9.]+k/[0-9.]+k tokens' | head -1 | cut -d/ -f2 | sed 's/ tokens//')
    percentage=$(echo "$output" | grep -oE '\([0-9.]+%\)' | head -1 | tr -d '()%')
  fi

  # Extract component breakdowns
  # Example: "⛁ System prompt: 3.1k tokens (1.5%)" or "⛁ Messages: 8 tokens (0.0%)"
  extract_component() {
    local component="$1"
    local tokens percentage
    # Match either "123k" or "123" for tokens
    tokens=$(echo "$output" | grep -i "$component:" | grep -oE '[0-9.]+k?[[:space:]]tokens' | head -1 | sed 's/ tokens//')
    percentage=$(echo "$output" | grep -i "$component:" | grep -oE '[0-9.]+%' | head -1 | tr -d '%')

    if [ -n "$tokens" ]; then
      echo "{\"tokens\": \"$tokens\", \"percentage\": ${percentage:-0}}"
    else
      echo "null"
    fi
  }

  # Build JSON using jq to ensure valid output
  jq -n \
    --arg model "${model:-unknown}" \
    --arg total_used "${total_used:-0}" \
    --arg total_capacity "${total_capacity:-0}" \
    --arg percentage "${percentage:-0}" \
    --argjson system_prompt "$(extract_component "System prompt")" \
    --argjson system_tools "$(extract_component "System tools")" \
    --argjson reserved "$(extract_component "Reserved")" \
    --argjson mcp_tools "$(extract_component "MCP tools")" \
    --argjson custom_agents "$(extract_component "Custom agents")" \
    --argjson memory_files "$(extract_component "Memory files")" \
    --argjson messages "$(extract_component "Messages")" \
    --argjson free_space "$(extract_component "Free space")" \
    '{
      model: $model,
      total: {
        used: $total_used,
        capacity: $total_capacity,
        percentage: ($percentage | tonumber)
      },
      components: {
        system_prompt: $system_prompt,
        system_tools: $system_tools,
        reserved: $reserved,
        mcp_tools: $mcp_tools,
        custom_agents: $custom_agents,
        memory_files: $memory_files,
        messages: $messages,
        free_space: $free_space
      } | with_entries(select(.value != null))
    }'
}

report() {
  local json

  # Read JSON from stdin or argument
  if [ -t 0 ]; then
    # stdin is a terminal, expect argument
    if [ $# -eq 0 ]; then
      echo "Error: No input provided. Pipe JSON or provide file path" >&2
      exit 1
    fi
    json=$(cat "$1")
  else
    # stdin has data
    json=$(cat)
  fi

  # Generate GHFM table
  cat <<EOF
## Claude Code Context Usage

**Model:** $(echo "$json" | jq -r '.model')
**Total Usage:** $(echo "$json" | jq -r '.total.used')/$(echo "$json" | jq -r '.total.capacity') tokens ($(echo "$json" | jq -r '.total.percentage')%)

| Component | Tokens | Percentage |
|-----------|--------|------------|
EOF

  # Add rows for each component
  echo "$json" | jq -r '.components | to_entries[] |
    "| " + (.key | gsub("_"; " ") | ascii_upcase) +
    " | " + .value.tokens +
    " | " + (.value.percentage | tostring) + "% |"
  '
}

# Main command dispatcher
case "${1:-}" in
  check)
    shift
    check "$@"
    ;;
  report)
    shift
    report "$@"
    ;;
  *)
    usage
    ;;
esac
