#!/usr/bin/env bash
# Create symlinks from ~/.claude/ to the Claude repo's user/ directory
#
# To test changes before installing, run ./dev.sh

set -euo pipefail

CLAUDE_REPO_HOME="${CLAUDE_REPO_HOME:-$HOME/.claude-repo}"
CLAUDE_DIR="$HOME/.claude"
SOURCE_DIR="$CLAUDE_REPO_HOME/user"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: Source directory not found: $SOURCE_DIR"
  echo "Run scripts/setup first to set up the repository."
  exit 1
fi

mkdir -p "$CLAUDE_DIR"

link_item() {
  local item="$1"
  local source="$SOURCE_DIR/$item"
  local target="$CLAUDE_DIR/$item"

  if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
    echo "  ✓ ~/.claude/$item (already linked)"
    return 0
  fi

  if [ -e "$target" ]; then
    echo "  ! ~/.claude/$item exists and would be overwritten"
    read -p "    Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "    Skipped ~/.claude/$item"
      return 0
    fi
  fi

  ln -sf "$source" "$target"
  echo "  - ~/.claude/$item -> $source"
}

for item in "$SOURCE_DIR"/*; do
  if [ -e "$item" ]; then
    basename_item="$(basename "$item")"
    link_item "$basename_item"
  fi
done

echo "✓ Claude configuration installed successfully"
