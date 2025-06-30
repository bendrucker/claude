#!/usr/bin/env bash
# Installs the language server MCP locally in a project

set -euo pipefail

# Check for language parameter
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <language>" >&2
  echo "Supported languages: go, typescript" >&2
  exit 1
fi

language="$1"
workspace=$(pwd)

# Configure language-specific settings
case "$language" in
  go)
    lsp_name="gopls"
    ;;
  typescript)
    lsp_name="typescript-language-server"
    ;;
  *)
    echo "Error: Unsupported language '$language'" >&2
    echo "Supported languages: go, typescript" >&2
    exit 1
    ;;
esac

# Check if LSP is available
case "$language" in
  go)
    if ! which gopls >/dev/null 2>&1; then
      echo "Error: gopls not found in PATH" >&2
      echo "Please install gopls for Go support" >&2
      exit 1
    fi
    ;;
  typescript)
    if ! which npx >/dev/null 2>&1; then
      echo "Error: npx not found in PATH" >&2
      echo "Please install Node.js for TypeScript support" >&2
      exit 1
    fi
    ;;
esac

# For mise/version managers, we need to ensure the MCP can find current tools
# Include mise shims directory and common system paths
mise_shims="$HOME/.local/share/mise/shims"
if [[ -d "$mise_shims" ]]; then
  path_env="$mise_shims:/usr/local/bin:/usr/bin:/bin"
else
  # Fallback to directory containing current LSP binary
  lsp_path=$(which "$lsp_name")
  lsp_bin_dir="${lsp_path%/*}"
  path_env="$lsp_bin_dir:/usr/local/bin:/usr/bin:/bin"
fi

# Get the full path to mcp-language-server
mcp_server_path=$(which mcp-language-server)
if [[ -z "$mcp_server_path" ]]; then
  echo "Error: mcp-language-server not found in PATH" >&2
  echo "Please install with: go install github.com/isaacphi/mcp-language-server@latest" >&2
  exit 1
fi

# Base command and args shared by all language servers  
base_args=$(jq -n --arg workspace "$workspace" \
  '["--workspace", $workspace, "--lsp"]')

# Common jq arguments
common_jq_args=(--argjson base_args "$base_args" --arg path_env "$path_env" --arg mcp_server_path "$mcp_server_path")

# Build language-specific configuration
case "$language" in
  go)
    lsp_args='["gopls"]'
    config=$(jq -n \
      "${common_jq_args[@]}" \
      --argjson lsp_args "$lsp_args" \
      --arg gopath "$(go env GOPATH)" \
      --arg gocache "$(go env GOCACHE)" \
      --arg gomodcache "$(go env GOMODCACHE)" \
      '{
        command: $mcp_server_path,
        args: ($base_args + $lsp_args),
        env: {
          PATH: $path_env,
          GOPATH: $gopath,
          GOCACHE: $gocache,
          GOMODCACHE: $gomodcache
        }
      }')
    ;;
  typescript)
    # Get the directory where this script is located (mcps directory)
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # Use npm exec to resolve the path to typescript-language-server
    tls_path="$(cd "$script_dir" && npm exec -- which typescript-language-server)"
    lsp_args=$(jq -n --arg tls_path "$tls_path" '[$tls_path, "--", "--stdio"]')
    config=$(jq -n \
      "${common_jq_args[@]}" \
      --argjson lsp_args "$lsp_args" \
      '{
        command: $mcp_server_path,
        args: ($base_args + $lsp_args),
        env: {
          PATH: $path_env
        }
      }')
    ;;
esac

# Add the MCP server configuration
claude mcp add-json "language-server-$language" "$config"
