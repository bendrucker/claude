#!/usr/bin/env bash
set -euo pipefail
cp -R "$(dirname "$0")/repo/." .
chmod +x bench/bench.sh
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git add -A
GIT_AUTHOR_DATE="2026-10-09T18:00:00Z" GIT_COMMITTER_DATE="2026-10-09T18:00:00Z" \
  git commit -qm "bench: time docsync sync with hyperfine"
