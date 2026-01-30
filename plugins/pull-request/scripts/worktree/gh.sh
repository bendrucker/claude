#!/usr/bin/env bash
# Worktree-aware gh wrapper
# Args: <branch> <gh-subcommand...>

branch="$1"; shift
wt_path=$(bun "${0%/*}/resolve.ts" "$branch")
if [ -n "$wt_path" ]; then
  cd "$wt_path" || exit 1
fi
exec gh "$@"
