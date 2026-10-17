#!/usr/bin/env bash
# Run Claude Code with user settings from this repo (for testing before install)
#
# Usage:
#   ./dev.sh                           # Test user settings only
#   ./dev.sh --plugin-dir ./plugins/x  # Also test a local plugin
#   ./dev.sh --desktop                 # Report the desktop app entrypoint to hooks and skills
#   ./dev.sh --desktop=claude-desktop-3p

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

args=()
for arg in "$@"; do
  case "$arg" in
    --desktop) export CLAUDE_CODE_ENTRYPOINT=claude-desktop ;;
    --desktop=*) export CLAUDE_CODE_ENTRYPOINT="${arg#--desktop=}" ;;
    *) args+=("$arg") ;;
  esac
done

exec claude \
  --setting-sources local,project \
  --settings "$SCRIPT_DIR/user/settings.json" \
  "${args[@]}"
