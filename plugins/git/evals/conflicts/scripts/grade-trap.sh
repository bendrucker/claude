#!/usr/bin/env bash
# Resolves a case with its trap/ or resolved/ files, pushes, and grades the result as a run would.
# usage: grade-trap.sh <case> <trap|resolved>
# Paths listed in <side>/.removed are deleted at every stop. Files in <side>/ overwrite the working tree at every stop. A trailing .fixture is dropped from each name,
# so fixture manifests and lockfiles stay invisible to dependency scanners.
# A <side>.sh beside <side>/ runs once in the work directory, with the case directory as its argument, in place of the overlay loop.
# After the operation it fetches and updates onto origin/main as a correct session does. A side of <side>-stale
# uses <side>/ but skips that step, to show on-main failing a branch left behind origin.
set -euo pipefail
suite=$(cd "$(dirname "$0")/.." && pwd)
case_dir="$suite/$1"
side=${2%-stale}
stale=false
[ "$side" = "$2" ] || stale=true
[ -d "$case_dir/$side" ] || [ -f "$case_dir/$side.sh" ] || { echo "no $side/ in $1" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/grade-trap.XXXXXX")
cd "$work"
bash "$case_dir/fixture.sh" > /dev/null

overlay() {
  (cd "$case_dir/$side" && find . -type f ! -name .removed) | while read -r file; do
    dest="${file%.fixture}"
    mkdir -p "$(dirname "$dest")"
    cp "$case_dir/$side/$file" "$dest"
  done
  if [ -f "$case_dir/$side/.removed" ]; then xargs rm -f < "$case_dir/$side/.removed"; fi
}

in_progress() {
  [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ] || [ -f .git/CHERRY_PICK_HEAD ]
}

if [ "$(cat "$case_dir/history/operation" 2>/dev/null)" = none ] && ! $stale; then
  git fetch -q origin
  git rebase -q origin/main > /dev/null 2>&1 || true
fi

if [ -f "$case_dir/$side.sh" ]; then
  bash "$case_dir/$side.sh" "$case_dir"
fi

for _ in $(seq 20); do
  in_progress || break
  [ -f "$case_dir/$side.sh" ] && break
  overlay
  git add -A
  if [ -f .git/MERGE_HEAD ]; then
    git commit -q --no-edit
  elif [ -f .git/CHERRY_PICK_HEAD ] && [ ! -d .git/rebase-merge ]; then
    GIT_EDITOR=true git cherry-pick --continue > /dev/null 2>&1 || git cherry-pick --skip > /dev/null 2>&1 || true
  elif ! GIT_EDITOR=true git rebase --continue > /dev/null 2>&1; then
    # A commit the overlay already absorbed applies empty and stops the rebase.
    if [ -z "$(git diff --name-only --diff-filter=U)" ]; then git rebase --skip > /dev/null 2>&1 || true; fi
  fi
done
in_progress && { echo "operation still in progress in $work" >&2; exit 1; }

if ! $stale; then
  git fetch -q origin
  if ! git merge-base --is-ancestor origin/main HEAD; then
    if [ "$(cat "$case_dir/history/operation" 2>/dev/null)" = merge ]; then
      git merge -q --no-edit origin/main
    else
      git rebase -q origin/main
    fi
  fi
fi

git push -q --force-with-lease origin HEAD

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
