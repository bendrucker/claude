#!/usr/bin/env bash

set -euo pipefail

MCP_CONFIG=".claude/mcp.json"

if [ ! -f "$MCP_CONFIG" ]; then
    echo "Error: $MCP_CONFIG not found"
    exit 1
fi

# Get list of existing MCP servers
existing_mcps=$(claude mcp list | cut -d: -f1 || echo "")

# Process each MCP server
jq -r '.mcpServers | keys[]' "$MCP_CONFIG" | while read -r server_name; do
    # Check if MCP already exists
    if echo "$existing_mcps" | grep -q "^$server_name$"; then
        echo "MCP server '$server_name' already exists, skipping"
        continue
    fi

    # Check for missing environment variables for this server only
    server_json=$(jq --arg name "$server_name" -r '.mcpServers[$name]' "$MCP_CONFIG")
    missing_vars=()
    while IFS= read -r var; do
        if [ -z "${!var:-}" ]; then
            missing_vars+=("$var")
        fi
    done < <(envsubst --variables "$server_json")

    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo "Error: Missing required environment variables for '$server_name':"
        printf '  %s\n' "${missing_vars[@]}"
        exit 1
    fi

    # Use envsubst to interpolate variables for this server
    server_config=$(echo "$server_json" | envsubst)

    echo "Adding MCP server: $server_name"
    claude mcp add-json "$server_name" "$server_config"
done
