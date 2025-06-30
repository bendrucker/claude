# MCP (Model Context Protocol) Servers

This directory contains configuration and tooling for managing [MCP](https://docs.anthropic.com/en/docs/mcp) servers with Claude Code.

## Overview

The MCP installer sets up MCP servers by reading configuration from `mcps.json` and installing them to Claude Code's configuration at `~/.claude.json`. It supports shell-style substitution of environment variables (`$VAR` and `${VAR}`), replacing them before adding the MCP to Claude Code.

MCP versions are specified in the relevant package manifest file for their runtime. For example, servers launched with `npx` are versioned via `package.json`, along with its accompanying lockfile. This allows MCP servers to be managed like traditional dependencies, instead of installing a mutable `latest` version on each run.

## Supported MCP Types

- **HTTP**: Connect to HTTP-based MCP servers
- **Go**: Run Go modules as MCP servers  
- **Docker**: Run MCP servers in Docker containers
- **uvx**: Run Python packages via uvx
- **npm**: Run Node.js packages via npx

## Adding a New MCP Server

### Step 1: Choose Your MCP Type

Determine which type of MCP server you want to add based on how it's distributed:

- **HTTP**: For web-based MCP services (e.g., GitHub Copilot MCP)
- **Go**: For Go modules published to module registry
- **Docker**: For containerized MCP servers
- **uvx**: For Python packages published to PyPI
- **npm**: For Node.js packages published to npm

### Step 2: Add Configuration to mcps.json

Edit `mcps.json` and add your MCP server under the appropriate type section:

#### HTTP MCP Example
```json
{
  "http": {
    "your-mcp-name": {
      "url": "https://your-mcp-server.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${YOUR_API_TOKEN}"
      }
    }
  }
}
```

#### Go MCP Example
```json
{
  "go": {
    "your-mcp-name": {
      "module": "github.com/owner/repo",
      "env": {
        "OPTIONAL_ENV_VAR": "${OPTIONAL_VALUE}"
      }
    }
  }
}
```

#### Docker MCP Example
```json
{
  "docker": {
    "your-mcp-name": {
      "service": "your-service-name"
    }
  }
}
```

#### uvx (Python) MCP Example
```json
{
  "uvx": {
    "your-mcp-name": {
      "package": "your-python-package",
      "env": {
        "PYTHON_ENV_VAR": "${YOUR_VALUE}"
      }
    }
  }
}
```

#### npm (Node.js) MCP Example
```json
{
  "npm": {
    "your-mcp-name": {
      "package": "@scope/your-package",
      "binary": "your-binary-name",
      "env": {
        "NODE_ENV_VAR": "${YOUR_VALUE}"
      }
    }
  }
}
```

### Step 3: Add Dependencies (if applicable)

For package-based MCPs, add the dependency to the appropriate manifest:

- **npm**: Add to `package.json` dependencies
- **uvx**: Add to `requirements.txt` or `requirements.in`
- **go**: Add to `go.mod` (if using go mod)
- **docker**: Define service in `docker-compose.yml`

### Step 4: Set Environment Variables

If your MCP requires environment variables:

1. Set them in your shell environment or `.env` file
2. Use shell-style substitution in the JSON config: `${VAR_NAME}`
3. Required variables will be validated during installation

### Step 5: Install the MCP

Run the installer to add your MCP to Claude Code:

```bash
# Install all MCPs
npx tsx install.ts

# Or install a specific MCP by name (if supported)
npx tsx install.ts --mcp your-mcp-name
```

### Step 6: Verify Installation

Check that your MCP was added to `~/.claude.json`:

```bash
# Preview the configuration that would be installed
npx tsx install.ts --print
```

## Environment Variable Guidelines

- Use descriptive names: `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.
- Document required variables in your MCP configuration
- Sensitive values (tokens, passwords) should be set as environment variables, not hardcoded
- The installer will validate that all referenced environment variables are set

## Troubleshooting

### Missing Environment Variables
If you see errors about missing environment variables:
1. Check that all `${VAR_NAME}` references in your config have corresponding environment variables set
2. Export the variables in your shell: `export VAR_NAME=value`
3. Re-run the installer

### MCP Server Not Starting
1. Check the MCP server logs in Claude Code
2. Verify the package/binary exists and is executable
3. Ensure environment variables are correctly set
4. Test the MCP server independently if possible

### Docker Issues
1. Ensure Docker is running
2. Check that the service is defined in `docker-compose.yml`
3. Verify the Docker image can be pulled/built
4. Check Docker service logs: `docker-compose logs your-service`

## Examples

See the existing configurations in `mcps.json` for working examples of each MCP type:

- **HTTP**: GitHub Copilot MCP with bearer token authentication
- **Go**: Godoc MCP server as a Go module
- **Docker**: Terraform MCP running in a container
- **uvx**: AWS Documentation MCP as a Python package
- **npm**: Package Registry and Puppeteer MCPs as Node.js packages