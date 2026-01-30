#!/usr/bin/env bash
# Resolve branch to worktree path
# Outputs the worktree path if found, empty otherwise
# Args: <branch>

branch="$1"
[ -z "$branch" ] && exit 0

git worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$branch" '
  /^worktree/ { p = $2 }
  /^branch/ { if ($2 == b) print p }
'
