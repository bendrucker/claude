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

    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo "Error: Missing required environment variables for '$server_name':"
        printf '  %s\n' "${missing_vars[@]}"
        exit 1
    fi

    # Use envsubst to interpolate variables for this server
    server_config=$(echo "$server_json" | envsubst)

    # Get transport type
    transport=$(echo "$server_config" | jq -r '.type // "stdio"')

    # Build base command
    cmd_args=("claude" "mcp" "add" "--transport" "$transport" "$server_name")

    # Add command/url and args
    if echo "$server_config" | jq -e '.url' > /dev/null; then
        # HTTP/SSE transport
        url=$(echo "$server_config" | jq -r '.url')
        cmd_args+=("$url")
    elif echo "$server_config" | jq -e '.command' > /dev/null; then
        # stdio transport
        command=$(echo "$server_config" | jq -r '.command')
        cmd_args+=("$command")

        # Add args if they exist
        if echo "$server_config" | jq -e '.args' > /dev/null; then
            cmd_args+=("--")
            while IFS= read -r arg; do
                cmd_args+=("$arg")
            done < <(echo "$server_config" | jq -r '.args[]')
        fi
    fi

    # Add environment variables
    if echo "$server_config" | jq -e '.env' > /dev/null; then
        while IFS= read -r env_var; do
            cmd_args+=("--env" "$env_var")
        done < <(echo "$server_config" | jq -r '.env | to_entries[] | "\(.key)=\(.value)"')
    fi

    # Add headers
    if echo "$server_config" | jq -e '.headers' > /dev/null; then
        while IFS= read -r header; do
            cmd_args+=("--header" "$header")
        done < <(echo "$server_config" | jq -r '.headers | to_entries[] | "\(.key): \(.value)"')
    fi

    echo "Adding MCP server: $server_name"
    "${cmd_args[@]}"
done
