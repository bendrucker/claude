#!/bin/bash

# Validate skill/agent/command names don't stutter with plugin namespace
# PostToolUse hook for Write and Edit tools on plugins/**

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

check_stuttering() {
    local name="$1"
    local type="$2"
    local plugin="$3"

    if [ -z "$name" ] || [ "$name" = "null" ]; then
        return
    fi

    local plugin_pattern=$(echo "$plugin" | sed 's/-/[-_]/g')

    if echo "$name" | grep -qiE "^${plugin_pattern}[-_]|[-_]${plugin_pattern}$|^${plugin_pattern}$"; then
        echo "Warning: $type name '$name' stutters with plugin namespace '$plugin'" >&2
        echo "  Qualified name would be: $plugin:$name" >&2
        echo "  Consider renaming to avoid repetition (e.g., $plugin:$plugin-foo -> $plugin:foo)" >&2
    fi
}

case "$file_path" in
    */agents/*.md)   name=$(basename "$file_path" .md); type="agent" ;;
    */commands/*.md) name=$(basename "$file_path" .md); type="command" ;;
    *)               name=$(grep -m1 -E '^name:' "$file_path" | sed 's/^name:[[:space:]]*//'); type="skill" ;;
esac
[ -n "$name" ] && check_stuttering "$name" "$type" "$plugin_name"

exit 0
