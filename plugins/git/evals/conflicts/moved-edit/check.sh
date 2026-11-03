#!/usr/bin/env bash
set -euo pipefail
tree=$(mktemp -d)
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$1"/. "$tree"/
(cd "$tree" && bun test)
if grep -Eq '(function|const) +parseLcov' "$tree/src/lcov.ts"; then
  echo "src/lcov.ts still defines parseLcov" >&2
  exit 1
fi
