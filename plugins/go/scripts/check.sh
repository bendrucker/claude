#!/bin/bash

# Check if a Go file is generated and block modifications
# Reads JSON input from stdin and extracts file_path

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    # No file_path in input, allow operation
    exit 0
fi

# Only check .go files
if [[ ! "$file_path" =~ \.go$ ]]; then
    exit 0
fi

# Check if file exists
if [ ! -f "$file_path" ]; then
    # File doesn't exist yet, allow operation
    exit 0
fi

# Check if file contains the "Code generated" marker before first non-comment, non-blank text
# Per Go convention: ^// Code generated .* DO NOT EDIT\.$
# This must appear before the first non-comment, non-blank text

found_marker=false
found_code=false

while IFS= read -r line; do
    # Skip blank lines
    if [[ "$line" =~ ^[[:space:]]*$ ]]; then
        continue
    fi

    # Check for code generated marker
    if [[ "$line" =~ ^//[[:space:]]Code[[:space:]]generated.*DO[[:space:]]NOT[[:space:]]EDIT\.$ ]]; then
        found_marker=true
        continue
    fi

    # Check if this is a comment line (line, block, or package doc comment)
    if [[ "$line" =~ ^// ]] || [[ "$line" =~ ^/\* ]]; then
        continue
    fi

    # If we get here, we've found non-comment, non-blank text
    found_code=true
    break
done < "$file_path"

if [ "$found_marker" = true ] && [ "$found_code" = true ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Cannot modify generated Go file: $file_path\"}}"
    exit 0
fi

# Allow operation
exit 0
