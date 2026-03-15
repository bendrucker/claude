#!/bin/bash
# Window-local fast shell for Claude agent team panes.
# Falls through to normal login shell for all other windows.
if [ "$(tmux show-option -wqv @claude_fast_shell)" = "1" ]; then
  claude_path="$(tmux show-environment CLAUDE_PATH 2>/dev/null)"
  if [ -n "$claude_path" ]; then
    export PATH="${claude_path#CLAUDE_PATH=}"
  fi
  exec bash --norc --noprofile
fi
exec "${SHELL:-/bin/zsh}" -l
