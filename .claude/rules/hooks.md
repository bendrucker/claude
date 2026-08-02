---
paths:
  - "**/hooks.json"
  - "**/hooks/**"
---

# Hooks

See the `claude-code:hook` skill for hook documentation. Plugin hooks are defined in `hooks/hooks.json`. A Biome PostToolUse hook (`.claude/hooks/biome/`) runs after file edits to check lint errors.

Raw `git worktree add` is denied in favor of the `worktrunk` skill, except under `tmp/`, allowed for disposable scripted verification checkouts.

Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes in shell-form hook commands: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/foo.ts"`. Matcher fields are not shell commands and should not be quoted. Run `bun scripts/check-hook-quoting.ts` to validate.

## Async

The `claude-code:hook` skill covers `async` and `asyncRewake`: what they drop, which events kill or outlive a backgrounded process, and when to use them. Read it before marking a hook async here.

In this repo only the vibe-island bridge and the herdr state export in `user/settings.json` qualify. Everything else gates a call or emits `hookSpecificOutput`, including every hook in `plugins/*/hooks/hooks.json`. Three of the bridge's 14 entries stay synchronous:

- `Stop`, because backgrounded `Stop` hooks are killed before they finish. Measured, and the reason the skill calls the event out.
- `StopFailure`, which shares the same stop path. Left synchronous for that reason rather than a measurement of its own.
- `PermissionRequest`, because the bridge blocks there to return a remote `permissionDecision`. That is what its 86400s timeout is for, and it follows from the general rule against backgrounding a hook that emits output.

`plugins/tmux/hooks/notification.ts` is not a notifier, despite the name. Its three hooks do a read-modify-write on shared tmux options and depend on completing in event order, so backgrounding any of them races the others.

## MCP Matchers

Hook matchers for MCP tools must include all three naming patterns (local, plugin, Claude AI). Run `bun scripts/check-mcp-matchers.ts` to validate. See [`plugins.md`](plugins.md) for the patterns and known display-name mappings.
