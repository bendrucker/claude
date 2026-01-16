#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

marketplace_plugins=$(jq -r '.plugins[].name' .claude-plugin/marketplace.json | sort)
enabled_plugins=$(jq -r '.enabledPlugins | keys[] | select(endswith("@bendrucker")) | sub("@bendrucker$"; "")' .claude/settings.json | sort)

missing=$(comm -23 <(echo "$marketplace_plugins") <(echo "$enabled_plugins"))

if [[ -n "$missing" ]]; then
  echo "Plugins in marketplace but not enabled in settings.json:"
  echo "$missing" | sed 's/^/  /'
  exit 1
fi

echo "All marketplace plugins are enabled in settings.json"
