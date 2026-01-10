#!/bin/bash

# Ensure a file has a trailing newline
# Reads JSON input from stdin and extracts file_path

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')
echo "Extracted file_path: $file_path"

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    echo "No file_path found in input" >&2
    exit 1
fi

# Check if file is empty
if [ ! -s "$file_path" ]; then
    echo "File is empty, skipping"
    exit 0
fi

# Check if file ends with newline
if [ "$(tail -c1 "$file_path" | wc -l)" -eq 0 ]; then
    echo "Adding trailing newline"
    # File doesn't end with newline, add one
    echo >> "$file_path"
else
    echo "File already has trailing newline"
fi