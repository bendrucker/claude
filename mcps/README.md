# MCP Servers

Manages [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers for Claude Code.

## Quick Start

First, install the CLI globally:
```bash
cd mcps/cli && npm link
```

Then use the commands:
```bash
# Install all MCP servers
mcp install mcps

# Install specific server
mcp install mcps github

# List available tools
mcp tools mcps

# Validate configuration
mcp validate mcps
```

## Configuration

Servers are defined in `mcps.json` with:
- **Runner**: How to launch the server (npm, uvx, docker, go, binary, http)
- **Targets**: Where to enable (user/project scope, labels for filtering)

Environment variables are substituted using shell syntax (`$VAR` or `${VAR}`).

## Adding Servers

1. Add server definition to `mcps.json`
2. Update version in appropriate manifest:
   - `package.json` for npm/npx servers
   - `requirements.txt` for Python/uvx servers
   - `go.mod` for Go servers
3. Run `mcp validate mcps` to check schema
4. Run `mcp install mcps` to update `~/.claude.json`

## Runners

- **npm**: Node packages via npx
- **uvx**: Python packages via uv
- **docker**: Docker services
- **go**: Go modules
- **binary**: Direct executables
- **http**: Remote HTTP endpoints
