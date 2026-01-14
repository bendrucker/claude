#!/bin/bash

# PreToolUse hook to detect inappropriate numbered sequences
# Usage: anti-numbering.sh <mode>
# Modes:
#   write - Block files with numbered patterns (more confident)
#   edit  - Warn about numbered patterns being added (softer guidance)

mode="${1:-write}"
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')

# Extract content based on tool type
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

# Skip non-text files that commonly use numbering
case "$file_path" in
  *.md|*.txt|*.rst)
    # Documentation files - check for numbered headers
    ;;
  *.sh|*.bash|*.py|*.go|*.js|*.ts|*.rb|*.java|*.c|*.cpp|*.h|*.hpp|*.rs)
    # Code files - check for step comments and numbered identifiers
    ;;
  *)
    # Other files - skip
    exit 0
    ;;
esac

# Patterns to detect
# 1. Numbered headers: # 1. Something, ## Step 2:, ### Phase 3, etc.
# 2. Step/Phase comments: // Step 1:, # Phase 2, /* Step 3 */
# 3. Numbered function/variable names: step1_, phase2Handler, doStep3

issues=()

# Check for numbered markdown headers
if echo "$content" | grep -qE '^#{1,6}\s+(([0-9]+\.)|((Step|Phase|Part)\s+[0-9]+))'; then
  issues+=("Numbered headers (e.g., '# 1. Something' or '## Step 2:')")
fi

# Check for step/phase comments in code
if echo "$content" | grep -qE '(//|#|/\*|\*)\s*(Step|Phase|Part)\s+[0-9]+'; then
  issues+=("Step/Phase comments (e.g., '// Step 1:')")
fi

# Check for numbered function/variable names (but not test cases or legitimate uses)
# Look for patterns like step1, phase2, doStep3, handlePhase4
if echo "$content" | grep -qE '\b(step|phase|part)[0-9]+|[0-9]+(step|phase|part)\b' | grep -vqE '(test|spec|example)'; then
  # More targeted check - look for definition patterns
  if echo "$content" | grep -qE '(func|function|def|const|let|var|type)\s+\w*(step|phase|part)[0-9]+'; then
    issues+=("Numbered identifiers in definitions (e.g., 'func step1()')")
  fi
fi

# No issues found
if [[ ${#issues[@]} -eq 0 ]]; then
  exit 0
fi

# Build the reason message
reason="Detected numbered sequences that create tight coupling:\n"
for issue in "${issues[@]}"; do
  reason+="- $issue\n"
done
reason+="\nUse descriptive names instead. See CLAUDE.md Organization guidelines."

# Output based on mode
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

if [[ "$mode" == "write" ]]; then
  # For Write: block with clear message
  output_json "deny" "$reason"
else
  # For Edit: softer guidance - ask instead of deny
  # This allows editing existing documents that already use these patterns
  output_json "ask" "This edit introduces numbered sequences. $reason"
fi
