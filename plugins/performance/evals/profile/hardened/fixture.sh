#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "$0")"
cp -R "$here/repo/." .
cc -O2 -o vendor/bin/tilecut "$here/src/tilecut.c"
codesign --force --options runtime -s - vendor/bin/tilecut 2>/dev/null
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git add -A
GIT_AUTHOR_DATE="2026-10-14T09:00:00Z" GIT_COMMITTER_DATE="2026-10-14T09:00:00Z" \
  git commit -qm "tiles: vendor tilecut 4.2"
"$(dirname "$0")/../relay/install.sh"
