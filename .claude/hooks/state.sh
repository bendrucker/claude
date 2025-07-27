#!/bin/bash

# Manage state files for Claude Code hooks
# Usage: 
#   get-state-file.sh get <type> <key>
#   get-state-file.sh set <type> <key> <value>

command="$1"
type="$2"
key="$3"
value="$4"

if [ -z "$command" ] || [ -z "$type" ] || [ -z "$key" ]; then
    echo "Usage: $0 get|set <type> <key> [value]" >&2
    exit 1
fi

# Create state file path based on key hash and type
key_hash=$(echo "$key" | shasum -a 256 | cut -d' ' -f1)
state_file="${TMPDIR:-/tmp}/claude-${key_hash}-${type}"

case "$command" in
    "get")
        if [ -f "$state_file" ]; then
            cat "$state_file"
        else
            # Default state is empty (compatible with empty files)
            echo ""
        fi
        ;;
    "set")
        if [ -z "$value" ]; then
            echo "Usage: $0 set <type> <key> <value>" >&2
            exit 1
        fi
        echo "$value" > "$state_file"
        ;;
    *)
        echo "Unknown command: $command" >&2
        exit 1
        ;;
esac