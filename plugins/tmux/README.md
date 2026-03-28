# Tmux Plugin

Tmux session awareness and pane interaction for Claude Code.

## Contents

- **Skill: tmux** — Pane management, content capture, and pane tracking
- **Hook: context** — SessionStart hook that injects tmux env vars
- **Hook: notification** — Bell and status bar notifications for permission prompts
- **Script: pane.ts** — Named pane tracking CLI
- **Script: tmux.ts** — Shared tmux command execution utilities
- **Script: tracking.ts** — Pane registry using tmux user options

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

The skill provides a PreToolUse hook that auto-allows read-only tmux commands and disables the sandbox for all tmux calls (the tmux socket is not in the sandbox allowlist). A second hook matcher handles script execution with sandbox bypass.

## Testing

```bash
bun test plugins/tmux
```
