# Tmux Plugin

Tmux session, window, and pane awareness for Claude Code.

## Contents

- **Skill: tmux** — Layout awareness, pane interaction, and notification monitoring
- **Hook: context** — SessionStart hook that injects tmux env vars
- **Hook: notification** — Bell and status bar notifications for permission prompts

## How It Works

A SessionStart hook detects whether Claude is running inside tmux and writes session/window/pane identifiers to `CLAUDE_ENV_FILE`. These env vars are available in all subsequent Bash calls.

The skill provides a PreToolUse hook that auto-allows safe tmux commands (read-only, navigation, layout) and disables the sandbox for all tmux calls. The safe command list is maintained in [`safe-commands.json`](skills/tmux/resources/safe-commands.json).
