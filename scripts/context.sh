#!/usr/bin/env bash
set -euo pipefail

# Context usage measurement and reporting for Claude Code
# Measures baseline context consumption from configuration (CLAUDE.md, MCP servers, etc.)

usage() {
  cat <<EOF
Usage: $0 <command> [options]

Commands:
  check [file]  Parse /context output and return JSON
                Reads from file or stdin
  report [file] Generate GitHub Flavored Markdown table from JSON
                Reads JSON from file or stdin

Examples:
  # From stdin
  claude --print '/context' --output-format json --verbose | $0 check > tmp/context.json

  # From file
  $0 check tmp/context-output.txt > tmp/context.json

  # Generate report
  $0 check | $0 report
  $0 report tmp/context.json

  # Combined
  claude --print '/context' --output-format json --verbose | $0 check | $0 report
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
  else
    tmpfile=$(mktemp)
    trap "rm -f $tmpfile" EXIT
    cat > "$tmpfile"

    if jq -e '.[1].message.content' "$tmpfile" >/dev/null 2>&1; then
      output=$(jq -r '.[1].message.content' "$tmpfile" | awk '/<local-command-stdout>/{flag=1;next}/<\/local-command-stdout>/{flag=0}flag')
    else
      output=$(cat "$tmpfile")
    fi
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

  # Extract all component breakdowns dynamically
  # Finds all lines matching pattern: "Component name: XXX tokens (YY%)"
  # Excludes "Messages" as it represents the /context command itself
  local components_json
  components_json=$(echo "$output" | grep -E ':[[:space:]]+[0-9.]+k?[[:space:]]tokens[[:space:]]+\([0-9.]+%\)' | awk -F': ' '{
    name = $1
    gsub(/^.*[⛁⛶⛝][[:space:]]+/, "", name)
    tokens = $2
    gsub(/ tokens.*/, "", tokens)
    percentage = $2
    gsub(/.*\(/, "", percentage)
    gsub(/%\).*/, "", percentage)
    if (name != "Messages") {
      key = tolower(name)
      gsub(/ /, "_", key)
      printf "{\"key\":\"%s\",\"name\":\"%s\",\"tokens\":\"%s\",\"percentage\":%s}\n", key, name, tokens, percentage
    }
  }' | jq -s 'map({(.key): {tokens: .tokens, percentage: .percentage}}) | add // {}')

  # Build JSON using jq to ensure valid output
  jq -n \
    --arg model "${model:-unknown}" \
    --arg total_used "${total_used:-0}" \
    --arg total_capacity "${total_capacity:-0}" \
    --arg percentage "${percentage:-0}" \
    --argjson components "$components_json" \
    '{
      model: $model,
      total: {
        used: $total_used,
        capacity: $total_capacity,
        percentage: ($percentage | tonumber)
      },
      components: $components
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
