#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

errors=()

for hooks_file in plugins/*/hooks/hooks.json; do
  [[ -f "$hooks_file" ]] || continue
  plugin_dir=$(echo "$hooks_file" | cut -d/ -f2)

  matchers=$(jq -r '.hooks | to_entries[] | .value[] | .matcher' "$hooks_file")

  while IFS= read -r matcher; do
    [[ -z "$matcher" ]] && continue

    # Split pipe-separated matcher into individual patterns
    IFS='|' read -ra patterns <<< "$matcher"

    for pattern in "${patterns[@]}"; do
      # Match non-plugin MCP patterns: mcp__<server>__<tool>
      if [[ ! "$pattern" =~ ^mcp__plugin_ ]] && [[ "$pattern" =~ ^mcp__([^_]+)__(.+)$ ]]; then
        server="${BASH_REMATCH[1]}"
        tool="${BASH_REMATCH[2]}"
        plugin_variant="mcp__plugin_${server}_${server}__${tool}"

        found=false
        for p in "${patterns[@]}"; do
          if [[ "$p" == "$plugin_variant" ]]; then
            found=true
            break
          fi
        done

        if [[ "$found" == "false" ]]; then
          errors+=("$hooks_file: matcher '$pattern' is missing plugin variant '$plugin_variant'")
        fi
      fi
    done
  done <<< "$matchers"
done

if [[ ${#errors[@]} -gt 0 ]]; then
  echo "MCP hook matchers missing plugin variants:"
  for err in "${errors[@]}"; do
    echo "  $err"
  done
  exit 1
fi

echo "All MCP hook matchers include plugin variants"
