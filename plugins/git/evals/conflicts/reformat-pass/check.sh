#!/usr/bin/env bash
# Passes when the pushed tree is Prettier-clean and the three branch behaviors hold.
# usage: check.sh <hidden-dir>
set -euo pipefail
hidden=$1
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cd "$tree"
"$hidden/../eval-tools/node_modules/.bin/prettier" --check .
cp -R "$hidden"/. "$tree"/
bun test
