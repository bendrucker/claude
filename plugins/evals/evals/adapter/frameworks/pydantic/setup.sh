#!/usr/bin/env bash
# Usage: setup.sh <dest>. Copies project/ to <dest> as a git repo whose `base` tag carries an older prompt.txt.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$1"
mkdir -p "$dest"
rsync -a "$here/project/" "$dest/"
cd "$dest"
git="git -c commit.gpgsign=false -c tag.gpgsign=false -c user.name=eval -c user.email=eval@example.com"
git init -q -b main
printf 'Answer the question.\n' > prompt.txt
git add -A
$git commit -q -m "base"
$git tag base
cp "$here/project/prompt.txt" prompt.txt
