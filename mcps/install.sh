#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPS_CONFIG="$SCRIPT_DIR/mcps.json"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

usage() {
    echo "Usage: $0 [--print]"
    echo "  --print    Print MCP configuration as JSON (compatible with Claude Desktop)"
    echo "  (default)  Add MCP servers using 'claude mcp add-json'"
    exit 1
}

# Parse arguments
PRINT_MODE=false
if [[ $# -gt 0 ]]; then
    case "$1" in
        --print)
            PRINT_MODE=true
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown option '$1'"
            usage
            ;;
    esac
fi

if [ ! -f "$MCPS_CONFIG" ]; then
    echo "Error: $MCPS_CONFIG not found"
    exit 1
fi

generate_mcp_config() {
    local server_name="$1"
    local server_config="$2"
    local type="$3"
    
    case "$type" in
        http)
            echo "$server_config" | envsubst
            ;;
        go)
            local module=$(echo "$server_config" | jq -r '.module')
            jq -n \
                --arg module "$module" \
                '{command: "go", args: ["run", $module]}' | envsubst
            ;;
        uvx)
            local package=$(echo "$server_config" | jq -r '.package')
            local env=$(echo "$server_config" | jq -r '.env // {}')
            jq -n \
                --arg package "$package" \
                --argjson env "$env" \
                '{command: "uvx", args: [$package], env: $env} | if ($env | length) == 0 then del(.env) else . end' | envsubst
            ;;
        npm)
            local package=$(echo "$server_config" | jq -r '.package')
            jq -n \
                --arg package "$package" \
                --arg prefix "$SCRIPT_DIR" \
                '{command: "npx", args: ["--prefix", $prefix, "-y", $package]}' | envsubst
            ;;
        docker)
            local service=$(echo "$server_config" | jq -r '.service')
            local compose_env=$(docker-compose -f "$COMPOSE_FILE" config --services 2>/dev/null | grep -q "^$service$" && \
                docker-compose -f "$COMPOSE_FILE" config 2>/dev/null | \
                yq eval ".services.$service.environment // []" - | \
                jq -s 'if length > 0 then .[0] | if type == "array" then map(split("=") | {(.[0]): .[1]}) | add else . end else {} end' 2>/dev/null || echo '{}')
            
            jq -n \
                --arg service "$service" \
                --arg compose_file "$COMPOSE_FILE" \
                --argjson env "$compose_env" \
                '{command: "docker-compose", args: ["-f", $compose_file, "run", "--rm", $service], env: $env} | if ($env | length) == 0 then del(.env) else . end' | envsubst
            ;;
        *)
            echo "Error: Unknown MCP type '$type'" >&2
            exit 1
            ;;
    esac
}

if [ "$PRINT_MODE" = true ]; then
    # Print mode: generate JSON compatible with Claude Desktop
    jq -n \
        --slurpfile mcps "$MCPS_CONFIG" \
        '$mcps[0] | keys[] as $name | 
        {($name): (
            $mcps[0][$name] as $config |
            $config.type as $type |
            if $type == "http" then
                $config | del(.type)
            elif $type == "go" then
                {command: "go", args: ["run", $config.module]}
            elif $type == "uvx" then
                {command: "uvx", args: [$config.package]} + 
                (if $config.env then {env: $config.env} else {} end)
            elif $type == "npm" then
                {command: "npx", args: ["--prefix", "'$SCRIPT_DIR'", "-y", $config.package]}
            elif $type == "docker" then
                {command: "docker-compose", args: ["-f", "'$COMPOSE_FILE'", "run", "--rm", $config.service]}
            else
                error("Unknown MCP type: \($type)")
            end
        )} | 
        {mcpServers: (reduce .[] as $item ({}; . + $item))}' | envsubst
else
    # Install mode: use claude mcp add-json
    if ! command -v claude >/dev/null 2>&1; then
        echo "Error: 'claude' command not found. Please install Claude Code CLI."
        exit 1
    fi
    
    # Get list of existing MCP servers
    existing_mcps=$(claude mcp list | cut -d: -f1 2>/dev/null || echo "")
    
    # Process each MCP server
    while IFS= read -r server_name; do
        # Check if MCP already exists
        if echo "$existing_mcps" | grep -q "^$server_name$"; then
            echo "MCP server '$server_name' already exists, skipping"
            continue
        fi
        
        server_config=$(jq --arg name "$server_name" -r '.[$name]' "$MCPS_CONFIG")
        type=$(echo "$server_config" | jq -r '.type')
        
        # Check for missing environment variables for this server only
        generated_config=$(generate_mcp_config "$server_name" "$server_config" "$type")
        missing_vars=()
        while IFS= read -r var; do
            if [ -z "${!var:-}" ]; then
                missing_vars+=("$var")
            fi
        done < <(envsubst --variables "$generated_config")
        
        if [ ${#missing_vars[@]} -gt 0 ]; then
            echo "Error: Missing required environment variables for '$server_name':"
            printf '  %s\n' "${missing_vars[@]}"
            exit 1
        fi
        
        echo "Adding MCP server: $server_name"
        claude mcp add-json "$server_name" "$generated_config"
    done < <(jq -r 'keys[]' "$MCPS_CONFIG")
fi