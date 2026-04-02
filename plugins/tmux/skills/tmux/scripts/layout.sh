#!/usr/bin/env bash
set -euo pipefail

[ -z "${TMUX_PANE:-}" ] && exit 0

info=$(tmux display-message -t "$TMUX_PANE" -p '#{session_name} #{window_index}' 2>/dev/null) || exit 0
read -r session current_window <<< "$info"

echo "## Panes"
echo ""
printf '%-14s  %-5s %-5s %-12s %-10s %s\n' "ID" "LEFT" "TOP" "SIZE" "CMD" "PATH"
tmux list-panes -t "$session:$current_window" -F '#{pane_id} #{pane_left} #{pane_top} #{pane_width}x#{pane_height} #{pane_current_command} #{pane_current_path}' 2>/dev/null | while read -r id left top size cmd path; do
  tag=""
  [ "$id" = "$TMUX_PANE" ] && tag=" (you)"
  printf '%-14s  %-5s %-5s %-12s %-10s %s\n' "${id}${tag}" "$left" "$top" "$size" "$cmd" "$path"
done

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
