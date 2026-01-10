#!/bin/bash

# Preserve trailing newline based on original state
# Reads JSON input from stdin and extracts file_path

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    echo "No file_path found in input" >&2
    exit 1
fi

# Get state script and retrieve original newline state
script_dir="$(dirname "$0")"
state_script="$script_dir/state.sh"
had_newline=$("$state_script" get newline "$file_path")

# If original file had a trailing newline, ensure it still has one
if [ "$had_newline" = "1" ]; then
    # Check if file is empty
    if [ ! -s "$file_path" ]; then
        exit 0
    fi
    
    # Check if file ends with newline
    if [ "$(tail -c1 "$file_path" | wc -l)" -eq 0 ]; then
        # File doesn't end with newline, add one
        echo >> "$file_path"
    fi
# If original file had no trailing newline, ensure it still has none
elif [ "$had_newline" = "" ]; then
    # Check if file is empty or doesn't exist
    if [ ! -s "$file_path" ]; then
        exit 0
    fi
    
    # Check if file ends with newline and remove it
    if [ "$(tail -c1 "$file_path" | wc -l)" -eq 1 ]; then
        # File ends with newline, remove it
        perl -i -pe 'chomp if eof' "$file_path"
    fi
fi

# Clean up state file
"$state_script" delete newline "$file_path"