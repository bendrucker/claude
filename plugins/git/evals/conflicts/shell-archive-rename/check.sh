#!/usr/bin/env bash
set -euo pipefail
for old in scripts/backup.sh scripts/archive.sh bin/archive.sh bin/backup; do
  test ! -e "$old"
done
command -v shellcheck > /dev/null
shellcheck --severity=warning bin/archive bin/nightly
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
cleanup() { rm -rf "$tree"; }
trap cleanup EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$1"/. "$tree"/
bash "$tree/tests/archive-test.sh"
