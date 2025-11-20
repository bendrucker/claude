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
    echo "ERROR: Cannot modify generated Go file: $file_path" >&2
    echo "" >&2
    echo "This file is generated code (contains '// Code generated ... DO NOT EDIT.' marker)." >&2
    echo "To make changes:" >&2
    echo "  1. Update the generator code instead" >&2
    echo "  2. Run 'go generate' to regenerate the file" >&2
    echo "" >&2
    exit 1
fi

# Allow operation
exit 0
