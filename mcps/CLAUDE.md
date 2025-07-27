# MCP Server Management

This directory contains configuration and tooling for managing Model Context Protocol (MCP) servers that extend Claude Code's capabilities.

## CLI Commands

The main interface is in `cli/` directory. First install it globally:

```bash
cd mcps/cli && npm link
```

The CLI takes a directory path containing `mcps.json` as its first argument:

```bash
# Install all configured MCP servers to both Claude Code and Claude Desktop
mcp install ./mcps

# Install to Claude Code only
mcp install ./mcps --app claude-code

# Install to Claude Desktop only
mcp install ./mcps --app claude-desktop

# Install a specific MCP server to both apps
mcp install ./mcps <name>

# Install a specific MCP server to Claude Code only
mcp install ./mcps <name> --app claude-code

# Print MCP configuration as JSON (for debugging)
mcp install ./mcps --print

# List available tools from MCP servers
mcp tools ./mcps

# List tools from a specific server
mcp tools ./mcps --server terraform

# Exclude specific servers when listing tools
mcp tools ./mcps --exclude terraform --exclude playwright

# Validate mcps.json against schema
mcp validate ./mcps
```

## Configuration Structure

MCP servers are defined in `mcps.json`:

```json
{
  "servers": {
    "server-name": {
      "runner": { /* launch configuration */ },
      "targets": { /* where to enable */ }
    }
  }
}
```

### Runners

Each runner type has specific configuration:

- **npm**: `{ "package": "pkg-name", "binary": "bin-name" }`
- **uvx**: `{ "package": "pkg-name", "binary": "bin-name", "env": {...} }`
- **docker**: `{ "service": "service-name" }`
- **go**: `{ "module": "module-path", "args": [...] }`
- **binary**: `{ "path": "/path/to/bin", "args": [...] }`
- **http**: `{ "url": "https://...", "headers": {...} }`

### Targets

- `scope`: "user" (all projects) or "project" (specific projects)
- `labels`: Filter by project labels (e.g., `{"language": ["go"]}`)

## Environment Variables

The installer supports shell-style substitution:
- `$VAR` or `${VAR}` in any string value
- Commonly used: `${GITHUB_TOKEN}`, `${HOME}`, `${PWD}`

## Version Management

MCP versions are pinned in manifest files:
- `package.json` + `package-lock.json`: npm/npx servers
- `pyproject.toml`: Python/uvx servers  
- `go.mod` + `go.sum`: Go servers

## Target Applications

The CLI supports installing MCP servers to multiple applications:

- **Claude Code**: `~/.claude.json`
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`

By default, MCPs are installed to both applications. Use the `--app` flag to target specific applications.

## Implementation Details

- `cli/`: CLI tools for managing MCP servers
- `cli/install.ts`: Main installer that writes to app config files
- `cli/lib/config.ts`: Configuration types and utilities
- `cli/lib/discovery.ts`: Auto-discovery of project labels
- `schema/`: JSON schemas for validation
- `docker-compose.yml`: Docker service definitions

## Workflow

1. Edit `mcps.json` to add/modify servers
2. Update version in relevant manifest file
3. Run `mcp validate mcps` to check configuration
4. Run `mcp install mcps` to apply changes (installs to both apps by default)
5. Restart Claude Code and/or Claude Desktop to load new servers