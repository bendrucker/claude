#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Print "<branch> (worktree|main)" for a pane's path, or nothing outside a repo.
git_segment() {
  local path=$1 branch gdir cdir kind
  { read -r branch || true; read -r gdir || true; read -r cdir || true; } \
    < <(git -C "$path" rev-parse --abbrev-ref HEAD --git-dir --git-common-dir 2>/dev/null)
  [ -z "$branch" ] && return 0
  [ "$branch" = "HEAD" ] && branch="detached"
  kind="main"
  [ -n "$cdir" ] && [ "$cdir" != "$gdir" ] && kind="worktree"
  printf '%s (%s)' "$branch" "$kind"
}

target="${1:-}"
if [ -z "$target" ]; then
  [ -z "${TMUX_PANE:-}" ] && { echo 'no window target' >&2; exit 1; }
  target=$(tmux display-message -t "$TMUX_PANE" -p '#{session_name}:#{window_index}' 2>/dev/null) || lookup_failed window
fi

TAB=$'\t'
fmt="#{pane_id}${TAB}#{pane_current_command}${TAB}#{pane_title}${TAB}#{pane_current_path}${TAB}#{pane_left}${TAB}#{pane_top}${TAB}#{pane_width}${TAB}#{pane_height}"

tmux list-panes -t "$target" -F "$fmt" 2>/dev/null | while IFS=$'\t' read -r id cmd title path left top width height; do
  tag=""
  [ "$id" = "${TMUX_PANE:-}" ] && tag=" (you)"

  line="${id}${tag} ${cmd}"

  if [ -n "$title" ]; then
    line="${line} $(trunc "$title")"
  fi

  if [ "$path" != "$PWD" ]; then
    short="${path/#"$HOME"/~}"
    line="${line} [${short}]"
  fi

  seg=$(git_segment "$path")
  [ -n "$seg" ] && line="${line} ${seg}"

  line="${line} @${left},${top} ${width}x${height}"

  echo "$line"
done
