#!/usr/bin/env bash
set -euo pipefail
hidden=$1
! git grep -qw split_chunks
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$hidden"/. "$tree"/
(cd "$tree" && python3 -B -m unittest discover)
