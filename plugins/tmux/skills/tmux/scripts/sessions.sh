#!/usr/bin/env bash
set -euo pipefail

current_session=""
if [ -n "${TMUX_PANE:-}" ]; then
  current_session=$(tmux display-message -t "$TMUX_PANE" -p '#{session_name}' 2>/dev/null || true)
fi

TAB=$'\t'
fmt="#{session_name}${TAB}#{session_windows}${TAB}#{session_attached}"

printf '%-16s %-8s %s\n' "NAME" "WINDOWS" "FLAGS"
tmux list-sessions -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r name windows attached; do
  flags=""
  [ "$name" = "$current_session" ] && flags="here"
  [ "$attached" = "1" ] && flags="${flags:+$flags, }attached"
  printf '%-16s %-8s %s\n' "$name" "$windows" "$flags"
done
