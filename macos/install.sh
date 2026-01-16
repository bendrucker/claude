#!/usr/bin/env bash

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

setup_claude_upgrade() {
  local plist_name="com.user.claude-upgrade.plist"
  local plist_src="$SCRIPT_DIR/$plist_name"
  local plist_dst="$HOME/Library/LaunchAgents/$plist_name"

  if [[ ! -f "$plist_src" ]]; then
    echo "  launchd plist not found, skipping upgrade setup"
    return
  fi

  echo "  Setting up nightly Claude upgrade..."

  mkdir -p "$HOME/Library/LaunchAgents"

  launchctl unload "$plist_dst" 2>/dev/null || true

  cp "$plist_src" "$plist_dst"

  if launchctl load "$plist_dst" 2>/dev/null; then
    echo "  ✓ upgrade launchd job installed"
  else
    echo "  ⚠ Failed to load upgrade launchd job (may need re-login)"
  fi
}

setup_claude_upgrade
