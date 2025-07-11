# MCP Server Management

This directory contains configuration and tooling for managing Model Context Protocol (MCP) servers that extend Claude Code's capabilities.

## CLI Commands

The main interface is `cli.ts`:

```bash
# Install all configured MCP servers to ~/.claude.json
./cli.ts install

# Install a specific MCP server
./cli.ts install <name>

# Print MCP configuration as JSON (for debugging)
./cli.ts install --print

# List available tools from MCP servers
./cli.ts tools [name]

# Exclude specific servers when listing tools
./cli.ts tools --exclude terraform --exclude playwright

# Validate mcps.json against schema
./cli.ts validate
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
- **uvx**: `{ "package": "pkg-name", "env": {...} }`
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
- `requirements.txt`: Python/uvx servers  
- `go.mod` + `go.sum`: Go servers

## Implementation Details

- `install.ts`: Main installer that writes to `~/.claude.json`
- `lib/config.ts`: Configuration types and utilities
- `lib/discovery.ts`: Auto-discovery of project labels
- `schema/`: JSON schemas for validation
- `docker-compose.yml`: Docker service definitions

## Workflow

1. Edit `mcps.json` to add/modify servers
2. Update version in relevant manifest file
3. Run `./cli.ts validate` to check configuration
4. Run `./cli.ts install` to apply changes
5. Restart Claude Code to load new servers