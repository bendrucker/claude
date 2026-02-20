# Tmux Plugin

Tmux session awareness and pane interaction for Claude Code.

## Contents

- **Skill: tmux** — Pane management, content capture, and key sending
- **Hook: context** — SessionStart hook that injects tmux env vars

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

The skill provides a PreToolUse hook that auto-allows read-only tmux commands and disables the sandbox for all tmux calls (the tmux socket is not in the sandbox allowlist).

## Testing

```bash
bun test plugins/tmux
```
