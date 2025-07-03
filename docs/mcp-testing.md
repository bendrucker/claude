# MCP Configuration Testing

This repository includes automated testing for MCP (Model Context Protocol) configurations to prevent breaking changes from being merged.

## Overview

The MCP validation system:
1. Tests that each MCP server can start up successfully
2. Verifies that MCP servers can list their available tools
3. Skips HTTP-based MCPs (external services)
4. Gracefully handles missing dependencies

## Test Suite

The test suite is located at `mcps/validation.test.ts` and tests:

- **Configuration Loading**: Ensures MCP configurations load without errors
- **Server Startup**: Attempts to start each non-HTTP MCP server
- **Tool Listing**: Verifies servers can respond to `tools/list` requests

### Tested MCPs

The following MCPs are tested automatically:
- `godoc` (requires Go)
- `aws-docs` (requires uv/uvx)
- `package-registry` (requires Node.js/npx)
- `puppeteer` (requires Node.js/npx)

**Skipped MCPs:**
- `github` (HTTP-based service)
- `terraform` (requires Docker, skipped in CI)
- `language-server-typescript` (requires specific workspace setup)

## GitHub Actions

The MCP validation runs on:
- Push to `main` branch (when MCP files change)
- Pull requests to `main` branch (when MCP files change)

### Dependencies Installed in CI

The GitHub Actions workflow installs:
- Node.js 18
- Go 1.21
- Python 3.11
- uv (for uvx command)

## Setting Up Required Status Checks

To prevent merging changes that break MCP configurations:

1. Go to your repository settings
2. Navigate to **Branches** → **Branch protection rules**
3. Add/edit the rule for `main` branch
4. Under **Require status checks to pass before merging**:
   - Check **Require status checks to pass before merging**
   - Add: `validate-mcps`

This ensures the MCP validation workflow must pass before any PR can be merged.

## Local Testing

Run the tests locally:

```bash
npm test -- mcps/validation.test.ts
```

The tests will gracefully skip MCPs that require dependencies not installed on your local machine.

## Adding New MCPs

When adding new MCP configurations:

1. Add the MCP to `mcps/mcps.json`
2. The test suite will automatically discover and test it
3. If the MCP requires special setup, add it to the skip list in `validation.test.ts`

## Troubleshooting

### Tests Failing Due to Missing Dependencies

The test suite should gracefully skip MCPs when dependencies are missing. If tests are failing:

1. Check that the MCP configuration is valid JSON
2. Verify the MCP server starts manually: `claude mcp list`
3. Ensure the MCP server responds to basic requests

### Adding New Dependencies

If adding an MCP that requires new system dependencies:

1. Update `.github/workflows/mcp-validation.yml` to install them
2. Test the workflow in a PR to ensure it works in CI

## Architecture

The testing system is built using:
- **vitest**: Test runner
- **@modelcontextprotocol/sdk**: Official MCP TypeScript SDK
- **mcps/config.ts**: Configuration management
- **mcps/install.ts**: Installation utilities (exports McpConfigManager)