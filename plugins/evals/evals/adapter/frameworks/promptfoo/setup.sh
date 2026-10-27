#!/usr/bin/env bash
# Usage: setup.sh <dest>
set -euo pipefail
# A pre-commit hook exports these, which would point the git calls below at the outer repo.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX
here="$(cd "$(dirname "$0")" && pwd)"
dest="$1"
mkdir -p "$dest"
cp -R "$here/project/." "$dest/"
cd "$dest"
git="git -c commit.gpgsign=false -c tag.gpgsign=false -c user.name=eval -c user.email=eval@example.com"
printf 'You are a helpful assistant. Explain your reasoning in detail before you answer.\n' > prompt.txt
git init -q
$git add -A
$git commit -q -m "base"
$git tag base
cp "$here/project/prompt.txt" prompt.txt
$git add -A
$git commit -q -m "project"
