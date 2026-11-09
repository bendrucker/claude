#!/usr/bin/env bash
set -euo pipefail
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -rf "$tree"' EXIT
git archive HEAD | tar -x -C "$tree"
export GOCACHE="$tree/.gocache" GOPATH="$tree/.gopath"
cp -R "$1"/. "$tree"/
(cd "$tree" && go test ./...)
if grep -Eq '^func +ParseCents' "$tree/money.go"; then
  echo "money.go still defines ParseCents" >&2
  exit 1
fi
