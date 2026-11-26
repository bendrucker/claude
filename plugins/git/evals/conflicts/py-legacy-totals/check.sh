#!/usr/bin/env bash
set -euo pipefail
test ! -e billing/legacy_totals.py
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
cleanup() { rm -rf "$tree"; }
trap cleanup EXIT
git archive HEAD | tar -x -C "$tree"
cp -R "$1"/. "$tree"/
cd "$tree"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover --start-directory billing/tests --top-level-directory .
