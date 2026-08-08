#!/bin/sh
# Nightly cleanup for `wt step prune`: removes worktrees/branches already
# merged into each repo's default branch. Only touches repos under ~/src,
# each identified by a real .git directory (a linked worktree has a .git
# *file*, so this naturally skips worktrees and only visits primary
# checkouts). See user/launchd/README.md for background and removal
# criteria.
set -eu

log() {
	printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1"
}

for git_dir in "$HOME"/src/*/.git "$HOME"/src/*/*/.git; do
	[ -d "$git_dir" ] || continue
	repo=$(dirname "$git_dir")
	log "pruning $repo"
	wt step prune --min-age=1d -C "$repo" 2>&1 || log "prune failed for $repo (exit $?)"
done
