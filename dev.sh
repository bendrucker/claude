#!/usr/bin/env bash
# Run Claude Code with user settings from this repo (for testing before install)
#
# Usage:
#   ./dev.sh                           # Test user settings only
#   ./dev.sh --plugin-dir ./plugins/x  # Also test a local plugin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec claude \
  --setting-sources local,project \
  --settings "$SCRIPT_DIR/user/settings.json" \
  "$@"
