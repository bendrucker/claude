#!/bin/bash

# Check if a file has a trailing newline and store the result
# Reads JSON input from stdin and extracts file_path

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    echo "No file_path found in input" >&2
    exit 1
fi

# Get state script
script_dir="$(dirname "$0")"
state_script="$script_dir/state.sh"

# Check if file is empty
if [ ! -s "$file_path" ]; then
    "$state_script" set newline "$file_path" ""
    exit 0
fi

# Check if file ends with newline and store result
if [ "$(tail -c1 "$file_path" | wc -l)" -eq 1 ]; then
    "$state_script" set newline "$file_path" "1"  # Has trailing newline
else
    "$state_script" set newline "$file_path" ""   # No trailing newline (default)
fi