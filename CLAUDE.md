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
- `spec.sh`: ShellSpec test file (run with `shellspec plugins/<name>/spec.sh`)

### Naming

The plugin name forms a namespace for its contents (e.g., `gitlab:ci-monitor`). Avoid repeating the plugin name in skill, agent, or command names to prevent stuttering like `gitlab:gitlab-ci`.

### Plugin READMEs

Each plugin should have a `README.md` with consistent sections:

- **Title**: `# Plugin Name` with a one-line description
- **Contents**: List what the plugin provides (skills, hooks, agents, commands)
- **Testing**: How to run tests (if `spec.sh` exists)

Do not include installation instructions or skill activation details—the README is an index, not documentation. Users can read the skill files directly for activation patterns.

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
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/default-state.sh"
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

## Testing

Plugins use [ShellSpec](https://shellspec.info/) for testing. Each plugin should have a `spec.sh` file that tests hook scripts directly by piping JSON input. See [plugins/linear/spec.sh](plugins/linear/spec.sh) for an example.

## Verification

Run `scripts/check-marketplace.sh` to verify all plugin directories are listed in `marketplace.json`. This check runs in CI and should pass before merging.

## Workflow

- The `.claude/` directory is symlinked to `~/.claude/`. New files are immediately available without re-running `install.sh`.
- Plugin changes take effect immediately in new Claude sessions.

## Settings

My `.claude/settings.json` enables all plugins from this marketplace plus third-party plugins. See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.
