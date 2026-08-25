---
paths:
  - "**/hooks.json"
  - "**/hooks/**"
---

# Hooks

See the `claude-code:hook` skill for hook documentation. Plugin hooks are defined in `hooks/hooks.json`. An oxlint/oxfmt hook (`.claude/hooks/ox/`) reports lint errors after file edits, and gates Stop and `git commit` with formatting plus a type check.

Raw `git worktree add` is denied in favor of the `worktrunk` skill, except under `tmp/`.

Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes in shell-form hook commands: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/foo.ts"`. Leave matcher fields unquoted. Run `bun scripts/check-hook-quoting.ts` to validate.

## Bash Matchers

A `Bash(...)` belongs in a per-hook `if`, and the entry's `matcher` stays a bare tool name. Run `bun scripts/check-hook-matchers.ts` to validate.

Treat a `Bash(...)` matcher or `if` condition as a spawn-reducing pre-filter, never as the authorization decision. It fails open on shell metacharacters, matching brace groups, for-loops, here-docs, redirects, and long pipelines that invoke something else entirely.

So every Bash-matched hook script must re-read `input.tool_input.command` and confirm the command really invokes what the hook governs before it denies, blocks, or rewrites. Working examples: `plugins/git/scripts/block-default-branch-commit.ts` (`invokesGitCommit`), `user/hooks/worktree/index.ts`, `plugins/shortcuts/hooks/open.ts`.

## Async

The `claude-code:hook` skill covers `async` and `asyncRewake`. Read it before marking a hook async here.

Only the vibe-island bridge and the herdr state export in `user/settings.json` qualify. Everything else gates a call or emits `hookSpecificOutput`, including every hook in `plugins/*/hooks/hooks.json`. Three bridge entries stay synchronous: `Stop` and `StopFailure`, whose backgrounded processes are killed before they finish, and `PermissionRequest`, which blocks to return a remote `permissionDecision`.

Never background `plugins/tmux/hooks/notification.ts`. Its three hooks do a read-modify-write on shared tmux options and must complete in event order.

## MCP Matchers

Hook matchers for MCP tools must include all three naming patterns (local, plugin, Claude AI). Run `bun scripts/check-mcp-matchers.ts` to validate. See [`plugins.md`](plugins.md) for the patterns and known display-name mappings.
