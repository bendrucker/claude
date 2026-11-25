#!/bin/sh
d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && root=$(dirname "$d") || root=$PWD
dir="$HOME/.claude/projects/$(printf %s "$root" | sed 's|[/.]|-|g')/memory"
if [ -d "$dir" ]; then
  echo "$dir ($(ls "$dir" | wc -l | tr -d ' ') files)"
else
  echo "none at $dir"
fi
