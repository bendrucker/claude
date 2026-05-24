#!/usr/bin/env bash
set -euo pipefail

MAX_TITLE=48

trunc() {
  local max=$1 str=$2
  if [ ${#str} -gt "$max" ]; then
    printf '%s…' "${str:0:$((max-1))}"
  else
    printf '%s' "$str"
  fi
}

TAB=$'\t'

target="${1:-}"
current_window=""
if [ -z "$target" ]; then
  [ -z "${TMUX_PANE:-}" ] && { echo 'no session target' >&2; exit 1; }
  info=$(tmux display-message -t "$TMUX_PANE" -p "#{session_name}${TAB}#{window_index}" 2>/dev/null) || { echo 'session lookup failed' >&2; exit 1; }
  IFS=$'\t' read -r target current_window <<< "$info"
fi

fmt="#{window_index}${TAB}#{window_name}${TAB}#{window_panes}${TAB}#{window_bell_flag}${TAB}#{window_activity_flag}${TAB}#{pane_title}"

printf '%-6s %-16s %-6s %-25s %s\n' "INDEX" "NAME" "PANES" "FLAGS" "TITLE"
tmux list-windows -t "$target" -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r idx name panes bell activity title; do
  flags=""
  [ "$idx" = "$current_window" ] && flags="here"
  [ "$bell" = "1" ] && flags="${flags:+$flags, }bell"
  [ "$activity" = "1" ] && flags="${flags:+$flags, }activity"
  printf '%-6s %-16s %-6s %-25s %s\n' "$idx" "$name" "$panes" "$flags" "$(trunc $MAX_TITLE "$title")"
done
