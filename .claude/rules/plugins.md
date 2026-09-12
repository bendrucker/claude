---
paths:
  - "plugins/**"
---

# Plugin Architecture

Each plugin has `.claude-plugin/plugin.json` plus optional `skills/`, `hooks/`, `commands/`, `agents/`.

Creating or renaming a plugin directory requires adding or updating its entry in `.claude-plugin/marketplace.json`, verified by `bun scripts/check-marketplace.ts`.

Load the `claude-code:skill` skill when creating or modifying skills.

## Audience

`writing` owns prose a person reads. `prompting` owns documents a model executes. Place a skill in exactly one of them.

The two share a plain-language core: active voice, no contrast frames, no hedging. They diverge on figurative language, which human prose uses and a model-executed document replaces with the literal fact, and on the mechanics only `prompting` has to state: placement against a context budget, pointer wording, completion criteria. A skill that serves both audiences drifts toward the human one and stops enforcing the mechanics.

## Naming

Commands, agents, and skills auto-namespace with `plugin-name:`, so `ci-monitor.md` in `gitlab` becomes `gitlab:ci-monitor`. An explicit prefix in frontmatter is optional. Anti-stuttering applies after the colon: `gitlab:gitlab-ci` is wrong, `gitlab:ci` is right. A plugin's primary skill may exactly match the plugin name (`writing:writing`, `herdr:herdr`); the form to avoid is the redundant suffix (`writing:writing-analyze`). Run `bun run skill-lint` to catch namespace mismatches and stuttering.

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

A skill that loads a skill from another plugin creates a plugin dependency. Declare it in the `dependencies` array of the depending plugin's `plugin.json`, as a bare plugin name resolved against this marketplace. Declare it only when the skill is unusable without the target, since `dependencies` requires the named plugin to be enabled and cannot express a choice between two providers.

Plugin-specific code dependencies go in the plugin's own `plugins/<name>/package.json`, added to the root `workspaces` array. No cross-plugin imports, and no reaching into `packages/` via relative paths. Shared code goes to an npm workspace package, declared in each plugin's `package.json`. Run `bun scripts/check-plugin-imports.ts` to verify.

### Lockfiles

A plugin declaring dependencies also commits `package-lock.json` beside its `package.json`. Claude Code installs a plugin's dependencies when it caches the plugin, at install, at update, and at session start on a machine that has not cached it yet. That install runs only when it finds a lockfile, and a plugin carrying the manifest alone is skipped with nothing written to the debug log. Its scripts then fail on an unresolved import the first time anything invokes them.

Generate the lockfiles with `bun run plugin-lockfiles generate`, which resolves each plugin in a scratch directory because npm otherwise walks up to the root `workspaces` declaration and writes a lockfile spanning the whole repo. `bun run plugin-lockfiles check` fails when a plugin is missing one or when its lockfile and manifest disagree, which is what makes `npm ci` fail under a frozen install.

The install passes `--ignore-scripts` and gives up after 60 seconds. A dependency that compiles in a lifecycle script has no `node_modules` to load at runtime, so it needs its own bootstrap into `${CLAUDE_PLUGIN_DATA}`. Prebuilt platform packages, which is how `sharp`, `@napi-rs/canvas`, and `@duckdb/node-api` ship, install and load fine.

Prefer npm's lockfile over `bun.lock`. Claude Code runs the matched lockfile's package manager from the user's PATH with no fallback, so an npm lockfile reaches installers without bun.
