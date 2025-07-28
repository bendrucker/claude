#!/bin/bash

# Ensure a file has a trailing newline
# Reads JSON input from stdin and extracts file_path

log() {
    echo "$@" >&2
}

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')
log "Extracted file_path: $file_path"

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    log "No file_path found in input"
    exit 1
fi

# Check if file is empty
if [ ! -s "$file_path" ]; then
    log "File is empty, skipping"
    exit 0
fi

# Check if file ends with newline
if [ "$(tail -c1 "$file_path" | wc -l)" -eq 0 ]; then
    log "Adding trailing newline"
    # File doesn't end with newline, add one
    echo >> "$file_path"
else
    log "File already has trailing newline"
fi