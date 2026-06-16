# Tmux Plugin

Tmux session, window, and pane awareness for Claude Code.

## Contents

- **Skill: tmux** — Layout awareness, pane interaction, and notification monitoring
- **Hook: context** — SessionStart hook that injects tmux env vars
- **Hook: resume-command**, a SessionStart hook that records the session's resume command in a pane-scoped tmux option for plugins like [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) to use when resuming a pane
- **Hook: notification** — Bell and status bar notifications for permission prompts
- A PreToolUse hook on `TeamCreate` that fixes the [agent team pane startup race](https://github.com/anthropics/claude-code/issues/25315) for tmux-backed teammates

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

Another SessionStart hook records the command that resumes the current session (`claude --resume <id>`) in the pane-scoped tmux option `@resume-command`, refreshed on every session start. Plugins like tmux-resurrect can read it back with `tmux show-options -p -t <pane> -qv @resume-command` to resume the session when restoring a pane. Outside tmux the hook is a no-op.

The skill provides a PreToolUse hook that auto-allows safe tmux commands (read-only, navigation, layout). The safe command list is maintained in [`safe-commands.json`](skills/tmux/resources/safe-commands.json).

## Agent Team Shell Race

The tmux team backend spawns each teammate in a new pane and immediately sends the `claude` command with `send-keys`. A slow rc file breaks this. The keystrokes land before the login shell finishes sourcing it, get swallowed, and the teammate never starts.

A PreToolUse hook on `TeamCreate` heads this off. It points tmux's `default-command` at [`shell-wrapper.sh`](hooks/shell-wrapper.sh) and pins `@claude_fast_shell` on the lead's window. New panes in that window exec a shell with rc loading skipped (`zsh --no-rcs`, `bash --norc`, `fish --no-config`), so the prompt is ready before `send-keys` fires. Every other window falls through to a normal login shell, so panes you open elsewhere behave as usual. One catch: a no-rc shell never rebuilds `PATH`, so the hook stashes the current value in the `CLAUDE_PATH` tmux environment variable and the wrapper restores it. Otherwise `claude` would not resolve.

A second hook on `TeamDelete` reverses all of this. It unsets `default-command`, clears the window's `@claude_fast_shell` pin, and removes `CLAUDE_PATH`. Teardown is optimistic. It rides on the normal end of a team and never touches the `Stop` path, where an earlier version burned a `bun` startup on every stop in every session. When a team is never deleted, its window keeps the no-rc shell until the tmux session ends. Kill the window to reset it sooner.

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
