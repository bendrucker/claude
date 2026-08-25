---
paths:
  - "plugins/**"
---

# Plugin Architecture

Each plugin has `.claude-plugin/plugin.json` plus optional `skills/`, `hooks/`, `commands/`, `agents/`.

Creating or renaming a plugin directory requires adding or updating its entry in `.claude-plugin/marketplace.json`. `bun scripts/check-marketplace.ts` verifies this.

When creating or modifying skills, load the `claude-code:skill` skill.

## Naming

Commands, agents, and skills auto-namespace with `plugin-name:` (e.g. `ci-monitor.md` in `gitlab` becomes `gitlab:ci-monitor`); an explicit prefix in frontmatter is optional. Anti-stuttering applies after the colon: `gitlab:gitlab-ci` is wrong, `gitlab:ci` is right. A plugin's primary skill may exactly match the plugin name as an intentional entry-skill pattern (`plugin:plugin`, e.g. `writing:writing`, `tmux:tmux`); the stutter to avoid is the redundant-suffix form (`plugin:plugin-foo`, e.g. `writing:writing-analyze`). Run `bun run skill-lint` to catch namespace mismatches and stuttering.

## MCP Tool Naming

MCP tools use one of three naming patterns, depending on connection type:

| Pattern | Format | Example |
|---------|--------|---------|
| Local | `mcp__<server>__<tool>` | `mcp__linear__create_issue` |
| Plugin | `mcp__plugin_<pluginName>_<server>__<tool>` | `mcp__plugin_linear_linear__create_issue` |
| Claude AI | `mcp__claude_ai_<DisplayName>__<tool>` | `mcp__claude_ai_Linear__save_issue` |

Claude AI display names and tool names can differ from local ones and aren't derivable (e.g. `linear`'s Claude AI display name is `Linear`, and it uses `save_issue` where local uses `create_issue`/`update_issue`).

Hook matchers must include all three patterns for matched tools. Skill `allowed-tools` needs the `mcp__claude_ai_<Name>` prefix. Run `bun scripts/check-mcp-matchers.ts` to validate hook matchers include all variants.

## Plugin READMEs

Each plugin's `README.md` needs a title with one-line description, a contents list (skills/hooks/agents/commands), and how to run tests if the plugin has them. The README is an index, not documentation.

## Plugin Metadata

Plugin `settings.json` only supports `agent` and `subagentStatusLine` keys. Don't create schema-only placeholder files. `plugin.json` supports an optional `"$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json"` for editor autocomplete, and `displayName` for human-readable names in the UI. Deleting a plugin's `commands/`, `agents/`, or `hooks/` directory requires removing the matching path key from `plugin.json` in the same change, or `claude plugin validate` fails CI on the dangling path.

## Dependencies

Plugin-specific dependencies go in the plugin's own `plugins/<name>/package.json`, added to the root `workspaces` array. No cross-plugin imports, and no reaching into `packages/` via relative paths. If two plugins need shared code, extract it to an npm workspace package and declare the dependency in each plugin's `package.json`. Run `bun scripts/check-plugin-imports.ts` to verify.
