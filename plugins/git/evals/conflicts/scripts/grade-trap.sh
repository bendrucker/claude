#!/usr/bin/env bash
# Resolves a case with its trap/ or resolved/ files, pushes, and grades the result as a run would.
# usage: grade-trap.sh <case> <trap|resolved>
# Files in <side>/ overwrite the working tree at every stop. A trailing .fixture is dropped from each name,
# so fixture manifests and lockfiles stay invisible to dependency scanners.
set -euo pipefail
suite=$(cd "$(dirname "$0")/.." && pwd)
case_dir="$suite/$1"
side=$2
[ -d "$case_dir/$side" ] || { echo "no $side/ in $1" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/grade-trap.XXXXXX")
cd "$work"
bash "$case_dir/fixture.sh" > /dev/null

overlay() {
  (cd "$case_dir/$side" && find . -type f) | while read -r file; do
    dest="${file%.fixture}"
    mkdir -p "$(dirname "$dest")"
    cp "$case_dir/$side/$file" "$dest"
  done
}

in_progress() {
  [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]
}

for _ in $(seq 20); do
  in_progress || break
  overlay
  git add -A
  if [ -f .git/MERGE_HEAD ]; then
    git commit -q --no-edit
  elif ! GIT_EDITOR=true git rebase --continue > /dev/null 2>&1; then
    # A commit the overlay already absorbed applies empty and stops the rebase.
    if [ -z "$(git diff --name-only --diff-filter=U)" ]; then git rebase --skip > /dev/null 2>&1 || true; fi
  fi
done
in_progress && { echo "operation still in progress in $work" >&2; exit 1; }

git push -q --force origin HEAD

hooks="$work/.git/origin.git/hooks"
echo "== $1 $side ($work)"
echo "-- .eval-verdicts"
cat .eval-verdicts
if [ -x "$hooks/eval-check" ]; then
  echo "-- check output"
  "$hooks/eval-check" "$hooks/eval-hidden" "$(cat "$hooks/eval-branch")" 2>&1 | tail -n 30 || true
fi
echo "-- graders"
bun "$suite/scripts/graders.ts" "$case_dir" "$work" --expect "$side"
