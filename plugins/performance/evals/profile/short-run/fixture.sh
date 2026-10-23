#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "$0")"
cp -R "$here/repo/." .
mkdir -p fixtures
python3 "$here/gen.py" > fixtures/large.c
make -s >/dev/null
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git add -A
GIT_AUTHOR_DATE="2026-10-14T09:00:00Z" GIT_COMMITTER_DATE="2026-10-14T09:00:00Z" \
  git commit -qm "tokcount: count tokens on save"
"$(dirname "$0")/../relay/install.sh"
