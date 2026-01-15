#!/usr/bin/env bash
# Create symlinks from ~/.claude/ to the Claude repo's .claude/ directory
#
# By default, links to ~/.claude-repo (installed copy).
# Use --dev to link to the dev copy instead (for testing changes).

set -euo pipefail

CLAUDE_REPO_HOME="${CLAUDE_REPO_HOME:-$HOME/.claude-repo}"
CLAUDE_REPO_DEV="${CLAUDE_REPO_DEV:-$HOME/src/bendrucker/claude}"
CLAUDE_DIR="$HOME/.claude"

# Parse arguments
USE_DEV=false
for arg in "$@"; do
  case $arg in
    --dev)
      USE_DEV=true
      shift
      ;;
  esac
done

if [[ "$USE_DEV" == "true" ]]; then
  SOURCE_DIR="$CLAUDE_REPO_DEV/.claude"
  echo "Installing Claude configuration from dev repo..."
else
  SOURCE_DIR="$CLAUDE_REPO_HOME/.claude"
  echo "Installing Claude configuration from installed repo..."
fi

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
