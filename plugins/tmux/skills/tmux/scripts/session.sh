#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TAB=$'\t'

target="${1:-}"
current_window=""
if [ -z "$target" ]; then
  [ -z "${TMUX_PANE:-}" ] && { echo 'no session target' >&2; exit 1; }
  info=$(tmux display-message -t "$TMUX_PANE" -p "#{session_name}${TAB}#{window_index}" 2>/dev/null) || lookup_failed session
  IFS=$'\t' read -r target current_window <<< "$info"
fi

fmt="#{window_index}${TAB}#{window_name}${TAB}#{window_panes}${TAB}#{window_bell_flag}${TAB}#{window_activity_flag}${TAB}#{pane_title}"

printf '%-6s %-16s %-6s %-25s %s\n' "INDEX" "NAME" "PANES" "FLAGS" "TITLE"
tmux list-windows -t "$target" -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r idx name panes bell activity title; do
  flags=""
  [ "$idx" = "$current_window" ] && flags="here"
  [ "$bell" = "1" ] && flags="${flags:+$flags, }bell"
  [ "$activity" = "1" ] && flags="${flags:+$flags, }activity"
  printf '%-6s %-16s %-6s %-25s %s\n' "$idx" "$name" "$panes" "$flags" "$(trunc "$title")"
done
