#!/usr/bin/env bash
set -euo pipefail

[ -z "${TMUX_PANE:-}" ] && exit 0

TAB=$'\t'

info=$(tmux display-message -t "$TMUX_PANE" -p "#{session_name}${TAB}#{window_index}" 2>/dev/null) || exit 0
IFS=$'\t' read -r session current_window <<< "$info"

echo "## Panes (current window)"
echo ""
printf '%-14s %-5s %-5s %-10s %-9s %-7s %-44s %s\n' "ID" "LEFT" "TOP" "SIZE" "CMD" "PID" "PATH" "TITLE"
current_fmt="#{pane_id}${TAB}#{pane_left}${TAB}#{pane_top}${TAB}#{pane_width}x#{pane_height}${TAB}#{pane_current_command}${TAB}#{pane_pid}${TAB}#{pane_current_path}${TAB}#{pane_title}"
tmux list-panes -t "$session:$current_window" -F "$current_fmt" 2>/dev/null | while IFS=$'\t' read -r id left top size cmd pid path title; do
  tag=""
  [ "$id" = "$TMUX_PANE" ] && tag=" (you)"
  printf '%-14s %-5s %-5s %-10s %-9s %-7s %-44s %s\n' "${id}${tag}" "$left" "$top" "$size" "$cmd" "$pid" "$path" "$title"
done

other_fmt="#{session_name}:#{window_index}.#{pane_id}${TAB}#{pane_current_command}${TAB}#{pane_pid}${TAB}#{pane_current_path}${TAB}#{pane_title}"
others=$(tmux list-panes -a -F "$other_fmt" 2>/dev/null | awk -F'\t' -v prefix="$session:$current_window." 'index($1, prefix) != 1')

if [ -n "$others" ]; then
  echo ""
  echo "## Other Panes"
  echo ""
  printf '%-25s %-9s %-7s %-44s %s\n' "TARGET" "CMD" "PID" "PATH" "TITLE"
  printf '%s\n' "$others" | while IFS=$'\t' read -r target cmd pid path title; do
    printf '%-25s %-9s %-7s %-44s %s\n' "$target" "$cmd" "$pid" "$path" "$title"
  done
fi

echo ""
echo "## Windows"
echo ""
printf '%-6s %-16s %-8s %s\n' "INDEX" "NAME" "PANES" "FLAGS"
tmux list-windows -t "$session" -F '#{window_index} #{window_name} #{window_panes} #{window_bell_flag} #{window_activity_flag}' 2>/dev/null | while read -r idx name panes bell activity; do
  flags=""
  [ "$idx" = "$current_window" ] && flags="here"
  [ "$bell" = "1" ] && flags="${flags:+$flags, }bell"
  [ "$activity" = "1" ] && flags="${flags:+$flags, }activity"
  printf '%-6s %-16s %-8s %s\n' "$idx" "$name" "$panes" "$flags"
done

echo ""
echo "## Sessions"
echo ""
printf '%-16s %-10s %s\n' "NAME" "WINDOWS" "FLAGS"
tmux list-sessions -F '#{session_name} #{session_windows} #{session_attached}' 2>/dev/null | while read -r name windows attached; do
  flags=""
  [ "$name" = "$session" ] && flags="here"
  [ "$attached" = "1" ] && flags="${flags:+$flags, }attached"
  printf '%-16s %-10s %s\n' "$name" "$windows" "$flags"
done
