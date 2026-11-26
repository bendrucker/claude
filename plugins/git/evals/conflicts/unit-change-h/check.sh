#!/usr/bin/env bash
set -euo pipefail
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$1"/. "$tree"/
bash "$tree/test/run.sh"
bash "$tree/test/archive.sh"
