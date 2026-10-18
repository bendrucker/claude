#!/usr/bin/env bash
# Run Claude Code with user settings from this repo (for testing before install)
#
# Usage:
#   ./dev.sh                           # Test the local settings
#   ./dev.sh --plugin-dir ./plugins/x  # Also test a local plugin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --settings takes one file, so join the user and managed layers the way
# Claude Code does: objects merge by key, lists and hooks concatenate, and the
# managed scalar wins. An installed drop-in still loads beside it and outranks
# it, so a scalar edit in managed/settings.json shows only where none is installed.
settings="$(mktemp)"
jq --slurp '
  def merge($a; $b):
    if ($a | type) == "object" and ($b | type) == "object" then
      reduce ($b | keys_unsorted[]) as $k ($a; .[$k] = merge($a[$k]; $b[$k]))
    elif ($a | type) == "array" and ($b | type) == "array" then $a + $b
    elif $b == null then $a
    else $b end;
  merge(.[0]; .[1])
' "$SCRIPT_DIR/user/settings.json" "$SCRIPT_DIR/managed/settings.json" >"$settings"

exec claude \
  --setting-sources local,project \
  --settings "$settings" \
  "$@"
