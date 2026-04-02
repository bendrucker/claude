#!/usr/bin/env bash
set -euo pipefail

for tool in markless batwatch bat; do
  path=$(which "$tool" 2>/dev/null || true)
  if [ -n "$path" ]; then
    echo "- $tool: $path"
  else
    echo "- $tool: not found"
  fi
done

editor=$(printenv EDITOR 2>/dev/null || true)
echo "- EDITOR: ${editor:-unset}"
