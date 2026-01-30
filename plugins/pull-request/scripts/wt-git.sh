#!/usr/bin/env bash
# Worktree-aware git wrapper
# Args: <branch> <git-subcommand...>

branch="$1"; shift
wt_path=$("${0%/*}/wt-resolve.sh" "$branch")
exec git ${wt_path:+-C "$wt_path"} "$@"
