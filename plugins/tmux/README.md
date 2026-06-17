# Tmux Plugin

Tmux session, window, and pane awareness for Claude Code.

## Contents

- **Skill: tmux** — Layout awareness, pane interaction, and notification monitoring
- **Hook: context** — SessionStart hook that injects tmux env vars
- **Hook: resume-command**, a SessionStart hook that records the session's resume command in a pane-scoped tmux option for plugins like [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) to use when resuming a pane
- **Hook: notification** — Bell and status bar notifications for permission prompts
- A PreToolUse hook on `Agent` that fixes the [agent team pane startup race](https://github.com/anthropics/claude-code/issues/25315) for tmux-backed teammates

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

Another SessionStart hook records the command that resumes the current session (`claude --resume <id>`) in the pane-scoped tmux option `@resume-command`, refreshed on every session start. Plugins like tmux-resurrect can read it back with `tmux show-options -p -t <pane> -qv @resume-command` to resume the session when restoring a pane. Outside tmux the hook is a no-op.

The skill provides a PreToolUse hook that auto-allows safe tmux commands (read-only, navigation, layout). The safe command list is maintained in [`safe-commands.json`](skills/tmux/resources/safe-commands.json).

## Agent Team Shell Race

The tmux team backend spawns each teammate in a new pane and immediately sends the `claude` command with `send-keys`. A slow rc file breaks this. The keystrokes land before the login shell finishes sourcing it, get swallowed, and the teammate never starts.

A PreToolUse hook on `Agent` heads this off. `Agent` is the tool that spawns teammates, and there is no longer a discrete team-creation event to hook: Claude Code removed the `TeamCreate` and `TeamDelete` tools in v2.1.178, and a team now forms implicitly on the first teammate spawn. The hook points tmux's `default-command` at [`shell-wrapper.sh`](hooks/shell-wrapper.sh) and pins `@claude_fast_shell` on the lead's window. New panes in that window exec a shell with rc loading skipped (`zsh --no-rcs`, `bash --norc`, `fish --no-config`), so the prompt is ready before `send-keys` fires. Every other window falls through to a normal login shell, so panes you open elsewhere behave as usual. The hook fires on every `Agent` call, including in-process subagents that never open a pane; the tmux options are idempotent, so the extra calls cost three `tmux set` invocations and nothing else. One catch: a no-rc shell never rebuilds `PATH`, so the hook stashes the current value in the `CLAUDE_PATH` tmux environment variable and the wrapper restores it. Otherwise `claude` would not resolve.

A `SessionEnd` hook reverses all of this. It unsets `default-command`, clears the window's `@claude_fast_shell` pin, and removes `CLAUDE_PATH`. Teardown rides on the end of the lead session, not the per-turn `Stop` path, where an earlier version burned a `bun` startup on every stop in every session. If the session exits without firing the hook, its window keeps the no-rc shell until the tmux session ends. Kill the window to reset it sooner.

## Sandbox

Claude Code's Bash sandbox blocks Unix socket connections, including tmux's control socket. The skill's scripts run sandboxed, so without an exception they fail with `pane lookup failed`.

Allow the socket's directory in your user settings (`~/.claude/settings.json`):

```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": ["~/.tmux"]
    }
  }
}
```

An `allowUnixSockets` entry matches a path and everything beneath it, so allowing the directory covers every socket regardless of the server's per-user socket name. Find yours with `tmux display-message -p '#{socket_path}'`. The default location varies by platform (often under `$TMPDIR`); set `TMUX_TMPDIR` to pin it somewhere stable like `~/.tmux`.
