#!/usr/bin/env bash
set -euo pipefail
cp -R "$(dirname "$0")/repo/." .
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git add -A
GIT_AUTHOR_DATE="2026-10-14T06:00:00Z" GIT_COMMITTER_DATE="2026-10-14T06:00:00Z" \
  git commit -qm "ledgerroll: roll the payments feed into a per-account ledger"
