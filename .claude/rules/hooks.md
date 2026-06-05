---
paths:
  - "**/hooks.json"
  - "**/hooks/**"
---

# Hooks

See the `claude-code:hook` skill for hook documentation. Plugin hooks are defined in `hooks/hooks.json`. This repository includes a Biome PostToolUse hook (`.claude/hooks/biome/`) that runs after file edits to check for lint errors.

Raw `git worktree add` is denied in favor of the `worktrunk` skill, except when the target is under `tmp/`, which is allowed for disposable scripted verification checkouts.

Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes in shell-form hook commands: `sh "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh" "${CLAUDE_PLUGIN_ROOT}/scripts/foo.ts"`. Matcher fields are not shell commands and should not be quoted. Run `bun scripts/check-hook-quoting.ts` to validate.

## Stdout Is Context

A hook's stdout is injected into the model as `additionalContext` (PreToolUse) or appended to the transcript. It must carry only the decision payload. `bun`'s install banner (`bun install v…`, `Checked N installs (no changes)`) prints to stdout and leaks into context when `node_modules` is stale, so a bun hook must never run as a bare `bun "<script>"`. Invoke it through the plugin's `hooks/run.sh`, which installs deps silently off stdout and runs the script with `--no-install`, so only the decision JSON reaches stdout regardless of bun version. New plugins with bun hooks need their own copy of `hooks/run.sh`, since plugins are distributed independently and cannot share a repo-level script. Run `bun scripts/check-hook-stdout.ts` to validate. Never write extra logging to stdout from a hook.

## MCP Matchers

Hook matchers for MCP tools must include all three naming patterns (local, plugin, Claude AI). Run `bun scripts/check-mcp-matchers.ts` to validate. See [`plugins.md`](plugins.md) for the patterns and known display-name mappings.
