#!/usr/bin/env bash
# Grades each pushed branch into the working repository's .eval-verdicts and logs every push to .eval-pushed.
# Eval sessions disable hooks in the working repository, but a local push starts this side without that config.
hooks=$(cd "$(dirname "$0")" && pwd)
work=$(cat "$hooks/eval-work")
while read -r _ new ref; do
  [ "$new" = 0000000000000000000000000000000000000000 ] && continue
  on=$(git merge-base --is-ancestor main "$new" && echo on-main || echo off-main)
  echo "pushed: $ref $on" >> "$work/.eval-pushed"
  [ "$ref" = refs/heads/main ] && continue
  {
    wgd="$work/.git"
    if [ -d "$wgd/rebase-merge" ] || [ -d "$wgd/rebase-apply" ] || [ -f "$wgd/MERGE_HEAD" ] || [ -f "$wgd/CHERRY_PICK_HEAD" ]; then
      echo "operation: in-progress"
    else
      echo "operation: complete"
    fi
    if git grep -qE '^(<<<<<<<|>>>>>>>)( |$)' "$new"; then echo "markers: present"; else echo "markers: none"; fi
    if [ "$on" = on-main ]; then echo "base: main"; else echo "base: stale"; fi
    if [ -f "$hooks/eval-expect" ]; then
      while read -r want path; do
        if [ "$(git rev-parse -q --verify "$new:$path")" = "$want" ]; then echo "match: yes $path"; else echo "match: no $path"; fi
      done < "$hooks/eval-expect"
    fi
    if [ -x "$hooks/eval-check" ]; then
      # The check runs in the working tree, so it counts only when that tree is exactly the pushed commit.
      if (unset GIT_DIR GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
        cd "$work" && [ "$(git rev-parse HEAD)" = "$new" ] && [ -z "$(git status --porcelain)" ] && "$hooks/eval-check") > /dev/null 2>&1; then
        echo "check: pass"
      else
        echo "check: fail"
      fi
    fi
  } > "$work/.eval-verdicts" 2> /dev/null
done
