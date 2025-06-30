#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(pwd)"
CLAUDE_DIR="$HOME/.claude"
SOURCE_DIR="$REPO_DIR/.claude"

mkdir -p "$CLAUDE_DIR"

# Function to create symlink with overwrite
link_item() {
    local item="$1"
    local source="$SOURCE_DIR/$item"
    local target="$CLAUDE_DIR/$item"

    # Check if target already exists and is the correct symlink
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
        echo "  ✓ ~/.claude/$item (already linked)"
        return 0
    fi

    # If target exists, prompt for confirmation
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

echo "Installing Claude configuration..."

# Process each item in .claude directory
for item in "$SOURCE_DIR"/*; do
    if [ -e "$item" ]; then
        basename_item="$(basename "$item")"
        link_item "$basename_item"
    fi
done

echo "Installing MCP configuration..."
npx tsx ./mcps/install.ts
echo "✓ MCP configuration installed successfully"

echo "✓ Claude configuration installed successfully"
