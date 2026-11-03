#!/usr/bin/env bash
# Builds a case's repository from its history/ patches and stops the rebase on its conflict.
# usage: scaffold.sh <case-dir>
# history/ holds an optional operation (rebase or merge), base.patch, main.patch, main.msg, branch.name, and branch/NN.patch with NN.msg per branch commit.
# An optional check.sh runs against each pushed result, and an optional expect lists `<blob> <path>` pairs it should match.
set -euo pipefail
case_dir=$1
history="$case_dir/history"
branch=$(cat "$history/branch.name")

source "$(dirname "$0")/../../../../packages/eval-stubs/preamble.sh" https://github.com/bendrucker/claude.git
git config rerere.enabled false
echo "/.eval-*" >> .git/info/exclude

apply() {
  if [ -s "$1" ]; then git apply --index "$1"; fi
}

# Installs each listed package so its tests resolve, and so both sides' packages sit in the run's cache.
install() {
  [ -f "$history/install" ] || return 0
  while read -r dir; do
    if [ -f "$dir/bun.lock" ]; then
      (cd "$dir" && bun install --frozen-lockfile --ignore-scripts > /dev/null)
    else
      (cd "$dir" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error > /dev/null)
    fi
  done < "$history/install"
}
echo "node_modules/" >> .git/info/exclude

apply "$history/base.patch"
commit "2026-10-01T09:00:00Z" "Initial state" > /dev/null
base=$(git rev-parse HEAD)
apply "$history/main.patch"
commit "2026-10-03T09:00:00Z" "$(cat "$history/main.msg")" > /dev/null
install
git switch -q -c "$branch" "$base"
for patch in "$history"/branch/*.patch; do
  apply "$patch"
  commit "2026-10-02T09:00:00Z" "$(cat "${patch%.patch}.msg")" > /dev/null
done
install

git init -q --bare .git/origin.git
git remote set-url origin "$PWD/.git/origin.git"
git push -q origin main "$branch"
git branch -q --set-upstream-to "origin/$branch"
git fetch -q origin

hooks=.git/origin.git/hooks
pwd > "$hooks/eval-work"
cp "$(dirname "$0")/scripts/post-receive.sh" "$hooks/post-receive"
if [ -f "$case_dir/check.sh" ]; then cp "$case_dir/check.sh" "$hooks/eval-check"; fi
if [ -f "$case_dir/expect" ]; then cp "$case_dir/expect" "$hooks/eval-expect"; fi
chmod +x "$hooks"/*
: > .eval-verdicts
: > .eval-pushed

operation=$(cat "$history/operation" 2>/dev/null || echo rebase)
if git "$operation" -q main > /dev/null 2>&1; then
  echo "$operation of main applied cleanly: no conflict to resolve" >&2
  exit 1
fi
