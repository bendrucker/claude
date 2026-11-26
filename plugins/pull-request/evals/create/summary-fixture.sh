#!/usr/bin/env bash
# Scaffolds a repo whose branch carries one empty commit named for the change, for cases
# whose prompt describes the diff in summary. Usage: summary-fixture.sh <branch> <subject>
set -euo pipefail
branch="$1"
subject="$2"
bash "$(dirname "${BASH_SOURCE[0]}")/stubs.sh"
git init -q -b main --separate-git-dir=.repo
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .repo/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/claude.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .repo/origin.git
git remote set-url --push origin "$PWD/.repo/origin.git"
git add -A
git commit -qm "Initial commit" --allow-empty
git switch -qc "$branch"
git commit -qm "$subject" --allow-empty
