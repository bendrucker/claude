#!/bin/bash

# Validate skill/agent/command names don't stutter with plugin namespace
# PostToolUse hook for Write and Edit tools

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$file_path" ] || [ "$file_path" = "null" ]; then
    exit 0
fi

extract_plugin_name() {
    local path="$1"
    if [[ "$path" =~ plugins/([^/]+)/ ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

plugin_name=$(extract_plugin_name "$file_path")
if [ -z "$plugin_name" ]; then
    exit 0
fi

if [ ! -f "$file_path" ]; then
    exit 0
fi

content=$(cat "$file_path")

check_stuttering() {
    local name="$1"
    local type="$2"
    local plugin="$3"

    if [ -z "$name" ] || [ "$name" = "null" ]; then
        return
    fi

    local plugin_pattern=$(echo "$plugin" | sed 's/-/[-_]*/g')

    if echo "$name" | grep -qiE "^${plugin_pattern}[-_]|[-_]${plugin_pattern}$|^${plugin_pattern}$"; then
        echo "Warning: $type name '$name' stutters with plugin namespace '$plugin'" >&2
        echo "  Qualified name would be: $plugin:$name" >&2
        echo "  Consider renaming to avoid repetition (e.g., $plugin:$plugin-foo -> $plugin:foo)" >&2
    fi
}

skill_name=$(echo "$content" | grep -E '^name:' | head -1 | sed 's/^name:[[:space:]]*//')
check_stuttering "$skill_name" "skill" "$plugin_name"

if [[ "$file_path" =~ /agents/.*\.md$ ]]; then
    agent_name=$(basename "$file_path" .md)
    check_stuttering "$agent_name" "agent" "$plugin_name"
fi

if [[ "$file_path" =~ /commands/.*\.md$ ]]; then
    command_name=$(basename "$file_path" .md)
    check_stuttering "$command_name" "command" "$plugin_name"
fi

exit 0
