#!/usr/bin/env bash
# Compact orientation view over `herdr api snapshot`, for bang-execution in SKILL.md.
# Degrades to one line rather than leaking a socket error into the skill body.
set -uo pipefail

if [ -z "${HERDR_PANE_ID:-}" ]; then
  echo "Not running under herdr (HERDR_PANE_ID unset). The commands below will not reach a server."
  exit 0
fi

for tool in herdr jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is not on PATH."
    exit 0
  fi
done

if ! snapshot=$(herdr api snapshot 2>&1) || [ "${snapshot:0:1}" != "{" ]; then
  echo "herdr api snapshot failed: ${snapshot%%$'\n'*}"
  exit 0
fi

if ! printf '%s' "$snapshot" | jq -r -f "$(dirname "$0")/orient.jq" 2>/dev/null; then
  echo "Snapshot did not match the expected shape. Read it directly with: herdr api snapshot | jq ."
fi
