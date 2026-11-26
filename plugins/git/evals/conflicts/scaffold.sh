#!/usr/bin/env bash
# Builds a case's repository from its history/ patches and stops the rebase on its conflict.
# usage: scaffold.sh <case-dir>
# history/ holds an optional operation (rebase or merge), base.patch, main.patch, main.msg, branch.name, and branch/NN.patch with NN.msg per branch commit.
# operation may also be cherry-pick (with pick.patch, pick.msg, and pick.name) or none (nothing starts).
# An optional upstream.patch and upstream.msg add a commit to origin's main that the working repository has not fetched.
# An optional check.sh runs against each pushed result, and an optional expect lists `<blob> <path>` pairs it should match.
# check.sh gets the path of the case's hidden/ copy and the branch's pre-operation tip as arguments.
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
start=$base
if [ -f "$history/pick.patch" ]; then start=main; fi
git switch -q -c "$branch" "$start"
for patch in "$history"/branch/*.patch; do
  apply "$patch"
  commit "2026-10-02T09:00:00Z" "$(cat "${patch%.patch}.msg")" > /dev/null
done
install

# A pick.patch case cuts the topic branch from main and starts the cherry-pick of pick.name, a commit cut from the base.
if [ -f "$history/pick.patch" ]; then
  git switch -q -c "$(cat "$history/pick.name")" "$base"
  apply "$history/pick.patch"
  commit "2026-10-02T12:00:00Z" "$(cat "$history/pick.msg")" > /dev/null
  git switch -q "$branch"
fi
# A stacked.name case adds a branch on top of the topic branch, with its commits in stacked/NN.patch and NN.msg.
if [ -f "$history/stacked.name" ]; then
  git switch -q -c "$(cat "$history/stacked.name")" "$branch"
  for patch in "$history"/stacked/*.patch; do
    apply "$patch"
    commit "2026-10-02T15:00:00Z" "$(cat "${patch%.patch}.msg")" > /dev/null
  done
  git switch -q "$branch"
fi

git init -q --bare .git/origin.git
git remote set-url origin "$PWD/.git/origin.git"
git push -q origin --all
git branch -q --set-upstream-to "origin/$branch"
git fetch -q origin
git remote set-head origin main

# Lands on origin only, so local main and origin/main stay behind it as in a clone that has not fetched.
# It goes in before the hook is installed so the grade log never records it.
if [ -f "$history/upstream.patch" ]; then
  upstream=$(mktemp -d "${TMPDIR:-/tmp}/upstream.XXXXXX")
  patch=$(cd "$history" && pwd)/upstream.patch
  git clone -q --branch main "$PWD/.git/origin.git" "$upstream"
  (
    cd "$upstream"
    git config commit.gpgsign false
    git apply --index "$patch"
    commit "2026-10-04T09:00:00Z" "$(cat "${patch%.patch}.msg")" > /dev/null
    git push -q origin HEAD:main
  )
  rm -rf "$upstream"
fi

hooks=.git/origin.git/hooks
pwd > "$hooks/eval-work"
cp "$(dirname "$0")/scripts/post-receive.sh" "$hooks/post-receive"
if [ -f "$history/stacked.name" ]; then : > "$hooks/eval-branches"; fi
if [ -f "$case_dir/check.sh" ]; then cp "$case_dir/check.sh" "$hooks/eval-check"; fi
if [ -f "$case_dir/expect" ]; then cp "$case_dir/expect" "$hooks/eval-expect"; fi
# Hidden checks sit outside the working tree, so the session never reads or edits them.
# A trailing .fixture keeps their tests and manifests out of this repo's test runs and dependency scanners.
if [ -d "$case_dir/hidden" ]; then
  (cd "$case_dir/hidden" && find . -type f) | while read -r file; do
    dest="$hooks/eval-hidden/${file%.fixture}"
    mkdir -p "$(dirname "$dest")"
    cp "$case_dir/hidden/$file" "$dest"
  done
fi
# A check's tools install here at scaffold time, so a grade never depends on the network.
if [ -f "$case_dir/tools" ]; then
  xargs npm install --prefix "$hooks/eval-tools" --ignore-scripts --no-audit --no-fund --loglevel=error < "$case_dir/tools" > /dev/null
fi
git rev-parse HEAD > "$hooks/eval-branch"
chmod +x "$hooks"/*
: > .eval-verdicts
: > .eval-pushed

operation=$(cat "$history/operation" 2>/dev/null || echo rebase)
# An optional before.sh runs before the operation starts and after.sh once it has stopped, both in the working repository.
if [ -f "$history/before.sh" ]; then bash "$history/before.sh"; fi
if [ "$operation" != none ]; then
  target=main
  quiet=-q
  if [ "$operation" = cherry-pick ]; then target=$(cat "$history/pick.name"); quiet=; fi
  if git "$operation" $quiet "$target" > /dev/null 2>&1; then
    echo "$operation of $target applied cleanly: no conflict to resolve" >&2
    exit 1
  fi
fi
if [ -f "$history/after.sh" ]; then bash "$history/after.sh"; fi
