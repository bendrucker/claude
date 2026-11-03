#!/usr/bin/env bash
set -euo pipefail
tree=$(mktemp -d)
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$1"/. "$tree"/
(cd "$tree" && bun test)
