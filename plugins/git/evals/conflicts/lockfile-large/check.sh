#!/usr/bin/env bash
set -euo pipefail
hidden=$1
branch=$2
tmp=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
lock=packages/app/package-lock.json
git show "main:$lock" > "$tmp/main.json"
git show "$branch:$lock" > "$tmp/branch.json"
bun "$hidden/pins.ts" "$lock" "$tmp/main.json" "$tmp/branch.json"
cd packages/app
npm ls --package-lock-only --all > /dev/null || { echo "npm ls found an inconsistent lockfile" >&2; exit 1; }
