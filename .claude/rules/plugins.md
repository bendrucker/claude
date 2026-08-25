---
paths:
  - "plugins/**"
---

# Plugin Architecture

Each plugin has `.claude-plugin/plugin.json` plus optional `skills/`, `hooks/`, `commands/`, `agents/`.

Creating or renaming a plugin directory requires adding or updating its entry in `.claude-plugin/marketplace.json`, verified by `bun scripts/check-marketplace.ts`.

Load the `claude-code:skill` skill when creating or modifying skills.

## Naming

Commands, agents, and skills auto-namespace with `plugin-name:`, so `ci-monitor.md` in `gitlab` becomes `gitlab:ci-monitor`. An explicit prefix in frontmatter is optional. Anti-stuttering applies after the colon: `gitlab:gitlab-ci` is wrong, `gitlab:ci` is right. A plugin's primary skill may exactly match the plugin name (`writing:writing`, `tmux:tmux`); the form to avoid is the redundant suffix (`writing:writing-analyze`). Run `bun run skill-lint` to catch namespace mismatches and stuttering.

## MCP Tool Naming

MCP tools use one of three naming patterns, depending on connection type:

| Pattern | Format | Example |
|---------|--------|---------|
| Local | `mcp__<server>__<tool>` | `mcp__linear__create_issue` |
| Plugin | `mcp__plugin_<pluginName>_<server>__<tool>` | `mcp__plugin_linear_linear__create_issue` |
| Claude AI | `mcp__claude_ai_<DisplayName>__<tool>` | `mcp__claude_ai_Linear__save_issue` |

Claude AI display names and tool names are not derivable from the local ones. `linear` displays as `Linear` and uses `save_issue` where local uses `create_issue`/`update_issue`.

Hook matchers must include all three patterns for matched tools, validated by `bun scripts/check-mcp-matchers.ts`. Skill `allowed-tools` needs the `mcp__claude_ai_<Name>` prefix.

## Plugin READMEs

A plugin `README.md` is an index, not documentation: a title with one-line description, a contents list (skills/hooks/agents/commands), and how to run tests if the plugin has them.

## Plugin Metadata

Plugin `settings.json` supports only `agent` and `subagentStatusLine`. Don't create schema-only placeholder files. `plugin.json` supports an optional `"$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json"` for editor autocomplete, and `displayName` for the UI.

Deleting a plugin's `commands/`, `agents/`, or `hooks/` directory requires removing the matching path key from `plugin.json` in the same change, or `claude plugin validate` fails CI on the dangling path.

## Dependencies

Plugin-specific dependencies go in the plugin's own `plugins/<name>/package.json`, added to the root `workspaces` array. No cross-plugin imports, and no reaching into `packages/` via relative paths. Shared code goes to an npm workspace package, declared in each plugin's `package.json`. Run `bun scripts/check-plugin-imports.ts` to verify.
