# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `plugins/`: Plugins providing language support, workflows, and integrations
- `.claude-plugin/marketplace.json`: Marketplace definition listing all available plugins
- `schemas/`: JSON Schema definitions for `plugin.schema.json` and `marketplace.schema.json`
- `.claude/`: My personal configuration directory, symlinked to `~/.claude`
- `install.sh`: Setup script that creates symlinks from `.claude/` to `~/.claude`

## Plugin Architecture

Each plugin in `plugins/` contains:
- `.claude-plugin/plugin.json`: Plugin metadata
- `skills/`: Skill definitions with `SKILL.md` and reference files
- `hooks/`: Optional hook definitions (`hooks.json`)
- `commands/`: Optional slash commands
- `agents/`: Optional agent definitions

### Naming

The plugin name forms a namespace for its contents (e.g., `gitlab:ci-monitor`). Avoid repeating the plugin name in skill, agent, or command names to prevent stuttering like `gitlab:gitlab-ci`.

### Plugin READMEs

Each plugin should have a `README.md` with consistent sections:

- **Title**: `# Plugin Name` with a one-line description
- **Contents**: List what the plugin provides (skills, hooks, agents, commands)
- **Testing**: How to run tests (if the plugin has tests)

Do not include installation instructions or skill activation details—the README is an index, not documentation. Users can read the skill files directly for activation patterns.

### Dependencies

The root `package.json` contains shared tooling (vitest, typescript) and dependencies used across multiple plugins (e.g., `url-pattern`). Plugin-specific dependencies belong in their own `package.json`:

- Create `plugins/<name>/package.json` for plugin-specific dependencies
- Add the plugin to the root `workspaces` array
- Run `npm install` to link the workspace

Avoid collecting all dependencies in the root package.json. Each plugin should be self-contained where practical.

### Lockfile Conflicts

When resolving `package-lock.json` conflicts during rebase, don't regenerate from scratch—this loses cross-platform optional dependencies. Instead:

1. Accept the lockfile from the base branch: `git checkout origin/main -- package-lock.json`
2. Run `npm install` to apply your `package.json` changes

This preserves platform-specific optional dependencies (Linux, Windows, etc.) that CI requires.

### Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing dependencies on first run, eliminating the need to run `npm install` before executing scripts. This simplifies hook execution since hooks run in isolated contexts where `node_modules` may not be readily available.

## Hooks

Hooks intercept tool calls and can modify inputs, block execution, or request user confirmation. Define hooks in `hooks/hooks.json`:

```json
{
  "description": "Sets default state for new issues",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__linear__create_issue",
        "hooks": [
          {
            "type": "command",
            "command": "bun ${CLAUDE_PLUGIN_ROOT}/hooks/default-state.ts"
          }
        ]
      }
    ]
  }
}
```

The `matcher` field supports regex patterns (e.g., `Edit|MultiEdit|Write`). Hook scripts receive JSON on stdin with `tool_name` and `tool_input`.

### PreToolUse Hook Outputs

Hook scripts can output JSON to control behavior:

- **Modify input**: Return `updatedInput` to merge fields into the tool input
  ```json
  {"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": {"state": "Todo"}}}
  ```
- **Block execution**: Return `permissionDecision: "deny"` with a reason
  ```json
  {"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "Use: gh repo view"}}
  ```
- **Request confirmation**: Return `permissionDecision: "ask"` with a reason
- **Allow without modification**: Exit with no output

See [plugins/linear/hooks/](plugins/linear/hooks/) for input modification and [plugins/github/scripts/](plugins/github/scripts/) for permission decisions.

### PostToolUse Hook Outputs

PostToolUse hooks run after a tool completes and can provide feedback to Claude:

- **Add context**: Return `additionalContext` to inform Claude about the result
  ```json
  {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Lint errors found..."}}
  ```

### Project-Level Hooks

Hooks can also be defined at the project level in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun ./hooks/biome"
          }
        ]
      }
    ]
  }
}
```

This repository includes a Biome PostToolUse hook (`.claude/hooks/biome/`) that runs after file edits to check for lint errors. If errors are found, they're fed back to Claude for correction.

## Testing

Plugins use [Vitest](https://vitest.dev/) for tests. Run all tests with `npm test` or filter by plugin with `npm test -- plugins/<name>`.

### CI Structure

Tests run per-plugin in the CI matrix for:
- **Parallelization**: Integration tests can take seconds; running in parallel across plugins is faster
- **Clear feedback**: Failed tests clearly indicate which plugin has the issue

Root-level tests (e.g., `hooks/`) run in a dedicated job since they're not part of any plugin.

### Conventions

- **`npm test` runs all tests**: Use specific scripts like `test:unit` or `test:integration` for subsets. Never make the default `npm test` run only a subset.
- **Use file patterns for test separation**: Vitest projects separate `*.test.ts` (unit) from `*.integration.ts` (integration) via include/exclude patterns. Don't use environment variables to conditionally skip tests.
- **No `.js` imports in TypeScript**: Import from `./module` not `./module.js`. The bundler/runtime handles resolution.
- **Prefer skills over agents**: Skills are invocable via the Skill tool. Agents require the Task tool. If something should be directly invocable, make it a skill.

### Local Plugin Testing

To test a plugin end-to-end without publishing, use `--plugin-dir` with `--setting-sources local` to isolate from user/project settings:

```bash
claude --plugin-dir ./plugins/<name> --setting-sources local
```

This loads only the specified plugin directory, bypassing marketplace-installed versions. Use this workflow to verify skills, hooks, and scripts work correctly before committing.

## Verification

Run `scripts/check-marketplace.sh` to verify all plugin directories are listed in `marketplace.json`. This check runs in CI and should pass before merging.

## Workflow

- The `.claude/` directory is symlinked to `~/.claude/`. New files are immediately available without re-running `install.sh`.
- Plugin changes take effect immediately in new Claude sessions.

## Settings

My `.claude/settings.json` enables all plugins from this marketplace plus third-party plugins. See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.
