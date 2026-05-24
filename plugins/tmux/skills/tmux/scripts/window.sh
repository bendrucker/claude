#!/usr/bin/env bash
set -euo pipefail

MAX_PATH=44
MAX_TITLE=48

trunc() {
  local max=$1 str=$2
  if [ ${#str} -gt "$max" ]; then
    printf '%s…' "${str:0:$((max-1))}"
  else
    printf '%s' "$str"
  fi
}

target="${1:-}"
if [ -z "$target" ]; then
  [ -z "${TMUX_PANE:-}" ] && { echo 'no window target' >&2; exit 1; }
  target=$(tmux display-message -t "$TMUX_PANE" -p '#{session_name}:#{window_index}' 2>/dev/null) || { echo 'window lookup failed' >&2; exit 1; }
fi

TAB=$'\t'
fmt="#{pane_id}${TAB}#{pane_left}${TAB}#{pane_top}${TAB}#{pane_width}x#{pane_height}${TAB}#{pane_current_command}${TAB}#{pane_pid}${TAB}#{pane_current_path}${TAB}#{pane_title}"

printf '%-14s %-5s %-5s %-10s %-9s %-7s %-44s %s\n' "ID" "LEFT" "TOP" "SIZE" "CMD" "PID" "PATH" "TITLE"
tmux list-panes -t "$target" -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r id left top size cmd pid path title; do
  tag=""
  [ "$id" = "${TMUX_PANE:-}" ] && tag=" (you)"
  printf '%-14s %-5s %-5s %-10s %-9s %-7s %-44s %s\n' "${id}${tag}" "$left" "$top" "$size" "$cmd" "$pid" "$(trunc $MAX_PATH "$path")" "$(trunc $MAX_TITLE "$title")"
done
