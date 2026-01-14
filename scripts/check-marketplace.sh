#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

plugin_dirs=$(ls -1 plugins/ | sort)
marketplace_plugins=$(jq -r '.plugins[] | select(.source | type == "string" and startswith("./plugins/")) | .source | ltrimstr("./plugins/")' .claude-plugin/marketplace.json | sort)

missing=$(comm -23 <(echo "$plugin_dirs") <(echo "$marketplace_plugins"))

if [[ -n "$missing" ]]; then
  echo "Plugins missing from marketplace.json:"
  echo "$missing" | sed 's/^/  /'
  exit 1
fi

echo "All plugin directories are listed in marketplace.json"
