---
paths:
  - "**/hooks.json"
  - "**/hooks/**"
---

# Hooks

See the `claude-code:hook` skill for hook documentation. Plugin hooks are defined in `hooks/hooks.json`. This repository includes a Biome PostToolUse hook (`.claude/hooks/biome/`) that runs after file edits to check for lint errors.

Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes in shell-form hook commands: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/foo.ts"`. Matcher fields are not shell commands and should not be quoted. Run `bun scripts/check-hook-quoting.ts` to validate.

## MCP Matchers

Hook matchers for MCP tools must include all three naming patterns (local, plugin, Claude AI). Run `bun scripts/check-mcp-matchers.ts` to validate. See [`plugins.md`](plugins.md) for the patterns and known display-name mappings.
