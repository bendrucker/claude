#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/claude.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
echo "# claude" > README.md
git add -A && git commit -qm "readme: add readme"
# The scenario carries a summary of the diff, not its files, so the branch holds one empty commit.
git switch -qc spend-bot-reviews-deliberately
git commit -q --allow-empty -m "pull-request,ship: spend bot reviews deliberately"
