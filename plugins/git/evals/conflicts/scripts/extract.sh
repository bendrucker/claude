#!/usr/bin/env bash
# Writes a case's history as patches from this repo's real commits.
# usage: extract.sh <case-dir> <base> <main> <branch> <path>...
# base.patch builds the paths at <base> and main.patch takes them to <main>.
# branch/ holds one patch and message per commit from <base> to <branch> that touches the paths.
set -euo pipefail
dir=$1 base=$2 main=$3 branch=$4
shift 4
empty=$(git hash-object -t tree /dev/null)
rm -rf "$dir/history"
mkdir -p "$dir/history/branch"
git diff --binary --no-renames "$empty" "$base" -- "$@" > "$dir/history/base.patch"
git diff --binary -M "$base" "$main" -- "$@" > "$dir/history/main.patch"
n=0
for sha in $(git rev-list --reverse --no-merges "$base..$branch" -- "$@"); do
  n=$((n + 1))
  id=$(printf '%02d' "$n")
  git diff --binary -M "$sha^" "$sha" -- "$@" > "$dir/history/branch/$id.patch"
  git log -1 --format=%s "$sha" > "$dir/history/branch/$id.msg"
done
