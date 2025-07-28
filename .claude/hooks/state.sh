#!/bin/bash

# Manage state files for Claude Code hooks
# Usage: 
#   state.sh get <type> <key>
#   state.sh set <type> <key> <value>
#   state.sh delete <type> <key>

command="$1"
type="$2"
key="$3"
value="$4"

if [ -z "$command" ] || [ -z "$type" ] || [ -z "$key" ]; then
    echo "Usage: $0 get|set|delete <type> <key> [value]" >&2
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
        if [ $# -lt 4 ]; then
            echo "Usage: $0 set <type> <key> <value>" >&2
            exit 1
        fi
        echo "$value" > "$state_file"
        ;;
    "delete")
        if [ -f "$state_file" ]; then
            rm "$state_file"
        fi
        ;;
    *)
        echo "Unknown command: $command" >&2
        exit 1
        ;;
esac