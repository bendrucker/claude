#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p git
cat > git/aliases.zsh <<'ZSH'
alias gs='git status --short'
ZSH
git add -A && git commit -qm "git: status alias"
git push -qu origin main
git switch -qc git-prune-merged
cat >> git/aliases.zsh <<'ZSH'

# Delete local branches already merged into the default branch.
gprune() {
  local base=${1:-$(git symbolic-ref --short refs/remotes/origin/HEAD | cut -d/ -f2)}
  git fetch --prune origin
  git branch --merged "origin/$base" | grep -vE "^\*|^\s*$base$" | xargs -r git branch -d
}
ZSH
git commit -qam "git: prune merged branches"
