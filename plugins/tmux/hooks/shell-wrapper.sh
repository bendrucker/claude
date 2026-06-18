#!/bin/bash
# Fast no-rc shell for Claude agent-team teammate panes.
# A PreToolUse(Agent) hook arms a short window (CLAUDE_FAST_SHELL_UNTIL)
# right before each teammate spawn. Panes that start inside that window skip
# rc loading so the prompt is ready before Claude's send-keys fires. Every
# other pane, including your own splits, gets a normal login shell.
armed_until="$(tmux show-environment CLAUDE_FAST_SHELL_UNTIL 2>/dev/null)"
armed_until="${armed_until#CLAUDE_FAST_SHELL_UNTIL=}"
if [ "${armed_until:-0}" -gt "$(date +%s)" ] 2>/dev/null; then
  claude_path="$(tmux show-environment CLAUDE_PATH 2>/dev/null)"
  if [ -n "$claude_path" ]; then
    export PATH="${claude_path#CLAUDE_PATH=}"
  fi

  shell="${SHELL:-/bin/zsh}"
  case "$(basename "$shell")" in
    zsh)  exec "$shell" --no-rcs --no-globalrcs ;;
    bash) exec "$shell" --norc --noprofile ;;
    fish) exec "$shell" --no-config ;;
    *)    exec "$shell" ;;
  esac
fi
exec "${SHELL:-/bin/zsh}" -l
