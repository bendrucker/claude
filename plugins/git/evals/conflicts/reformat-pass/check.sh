#!/usr/bin/env bash
# Passes when the pushed tree is Prettier-clean and the three branch behaviors hold.
# usage: check.sh <hidden-dir>
set -euo pipefail
hidden=$1
tree=$(mktemp -d)
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cd "$tree"
bunx prettier@3.9.10 --check .
cp -R "$hidden"/. "$tree"/
bun test
