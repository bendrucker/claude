---
paths:
  - "**/hooks.json"
  - "**/hooks/**"
---

# Hooks

See the `plugin:hook` skill for hook documentation. An oxlint hook (`.claude/hooks/ox/`) reports lint errors after file edits. The commit gate (format, lint, type check, import checks) lives in `.pre-commit-config.yaml`: prek runs it as the git pre-commit hook, and `.claude/hooks/stop/` runs it over a turn's edited files before the session stops. Add a new gate to that file so both paths run it.

Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes in shell-form hook commands: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/foo.ts"`. Leave matcher fields unquoted. Run `bun scripts/check-hook-quoting.ts` to validate.

## Bash Matchers

A `Bash(...)` belongs in a per-hook `if`, and the entry's `matcher` stays a bare tool name. Run `bun scripts/check-hook-matchers.ts` to validate.

`${CLAUDE_PLUGIN_ROOT}` expands only in `command` strings, so never put it in a `matcher` or `if`.

Treat a `Bash(...)` matcher or `if` condition as a spawn-reducing pre-filter, never as the authorization decision. It fails open on shell metacharacters, matching brace groups, for-loops, here-docs, redirects, and long pipelines that invoke something else entirely.

So every Bash-matched hook script must re-read `input.tool_input.command` and confirm the command really invokes what the hook governs before it denies, blocks, or rewrites. Working examples: `plugins/git/scripts/block-default-branch-commit.ts` (`invokesGitCommit`), `user/hooks/worktree/index.ts`, `plugins/shortcuts/hooks/open.ts`.

## Async

The `plugin:hook` skill covers `async` and `asyncRewake`. Read it before marking a hook async here.

Background a hook only when nothing in the session waits on its result: a notifier, a state export, a cache warm-up whose consumers check for it themselves. A hook that gates a call or emits `hookSpecificOutput` stays synchronous. Keep `Stop` and `StopFailure` synchronous, since Claude Code kills their backgrounded processes before they finish, and `PermissionRequest`, which blocks to return a decision.


## MCP Matchers

Run `bun scripts/check-mcp-matchers.ts` for MCP tool matchers. The three naming patterns are in [`plugins.md`](plugins.md).
