#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

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
  target=$(tmux display-message -t "$TMUX_PANE" -p '#{session_name}:#{window_index}' 2>/dev/null) || lookup_failed window
fi

TAB=$'\t'
fmt="#{pane_id}${TAB}#{pane_current_command}${TAB}#{pane_title}${TAB}#{pane_current_path}"

tmux list-panes -t "$target" -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r id cmd title path; do
  tag=""
  [ "$id" = "${TMUX_PANE:-}" ] && tag=" (you)"

  line="${id}${tag} ${cmd}"

  if [ -n "$title" ]; then
    line="${line} $(trunc $MAX_TITLE "$title")"
  fi

  if [ "$path" != "$PWD" ]; then
    short="${path/#"$HOME"/~}"
    line="${line} [${short}]"
  fi

  echo "$line"
done
