---
paths:
  - "plugins/**"
---

# Plugin Architecture

Each plugin in `plugins/` contains:
- `.claude-plugin/plugin.json`: Plugin metadata
- `skills/`: Skill definitions with `SKILL.md` and reference files
- `hooks/`: Optional hook definitions (`hooks.json`)
- `commands/`: Optional slash commands
- `agents/`: Optional agent definitions

When creating or modifying skills, load the `claude-code:skill` skill for authoring best practices, structure conventions, and content features.

## Naming

The plugin name forms a namespace for its contents (e.g., `gitlab:ci-monitor`). Commands and agents are auto-namespaced by the plugin system: the filename becomes the qualified name (e.g., `ci-monitor.md` in the `gitlab` plugin becomes `gitlab:ci-monitor`). Skills are auto-prefixed with `plugin-name:` when the frontmatter `name` doesn't already start with that prefix. Including the prefix explicitly is optional but harmless (avoids double-prefixing).

Anti-stuttering applies to the part after the colon: `gitlab:gitlab-ci` is wrong, `gitlab:ci` is right. Run `bun run skill-lint` to catch namespace mismatches and stuttering.

## MCP Tool Naming

MCP tools appear with three naming patterns depending on how the server is connected:

| Pattern | Format | Example |
|---------|--------|---------|
| Local | `mcp__<server>__<tool>` | `mcp__linear__create_issue` |
| Plugin | `mcp__plugin_<pluginName>_<server>__<tool>` | `mcp__plugin_linear_linear__create_issue` |
| Claude AI | `mcp__claude_ai_<DisplayName>__<tool>` | `mcp__claude_ai_Linear__save_issue` |

Claude AI display names differ from server names (e.g., `Linear` not `linear`) and cannot be derived programmatically. Tool names may also differ between variants: Linear uses `save_issue` instead of `create_issue`/`update_issue`. Known mappings:

| Server | Display Name | Local Tool | Claude AI Tool |
|--------|-------------|------------|----------------|
| `linear` | `Linear` | `create_issue` | `save_issue` |
| `linear` | `Linear` | `update_issue` | `save_issue` |

Hook matchers must include all three patterns for matched tools. Skill `allowed-tools` needs the `mcp__claude_ai_<Name>` prefix. Run `bun scripts/check-mcp-matchers.ts` to validate hook matchers include all variants.

## Plugin READMEs

Each plugin should have a `README.md` with consistent sections:

- **Title**: `# Plugin Name` with a one-line description
- **Contents**: List what the plugin provides (skills, hooks, agents, commands)
- **Testing**: How to run tests (if the plugin has tests)

Do not include installation instructions or skill activation details, the README is an index, not documentation. Users can read the skill files directly for activation patterns.

## Plugin Metadata

Plugin `settings.json` only supports `agent` and `subagentStatusLine` keys. Don't create schema-only placeholder files. `plugin.json` supports an optional `"$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json"` for editor autocomplete, and `displayName` for human-readable names in the UI.

## Dependencies

The root `package.json` contains shared tooling (typescript) and dependencies used across multiple plugins (e.g., `url-pattern`). Plugin-specific dependencies belong in their own `package.json`:

- Create `plugins/<name>/package.json` for plugin-specific dependencies
- Add the plugin to the root `workspaces` array
- Run `bun install` to link the workspace

Avoid collecting all dependencies in the root package.json. Each plugin should be self-contained where practical.

Plugins must not import from outside their own directory. No cross-plugin imports, no reaching into `packages/` or root-level modules via relative paths. If two plugins need shared code, extract it to an npm workspace package and declare the dependency in each plugin's `package.json`. Run `bun scripts/check-plugin-imports.ts` to verify.
