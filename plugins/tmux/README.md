# Tmux Plugin

Tmux session, window, and pane awareness for Claude Code.

## Contents

- **Skill: tmux** — Layout awareness, pane interaction, and notification monitoring
- **Hook: context** — SessionStart hook that injects tmux env vars
- **Hook: resume-command**, a SessionStart hook that records the session's resume command in a pane-scoped tmux option for plugins like [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) to use when resuming a pane
- **Hook: notification** — Bell and status bar notifications for permission prompts

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

Another SessionStart hook records the command that resumes the current session (`claude --resume <id>`) in the pane-scoped tmux option `@resume-command`, refreshed on every session start. Plugins like tmux-resurrect can read it back with `tmux show-options -p -t <pane> -qv @resume-command` to resume the session when restoring a pane. Outside tmux the hook is a no-op.

The skill provides a PreToolUse hook that auto-allows safe tmux commands (read-only and within-window layout). The safe command list is maintained in [`safe-commands.json`](skills/tmux/resources/safe-commands.json). Window-switching verbs (`select-window`, `switch-client`, `next`/`previous`/`last-window`) are deliberately excluded, so they fall through to a permission prompt. This keeps cross-window navigation an explicit choice rather than a silent one during autonomous work.

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
