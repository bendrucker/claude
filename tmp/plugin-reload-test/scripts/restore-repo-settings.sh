#!/usr/bin/env bash
# Restore the repo's .claude/settings.json to its original state
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
git checkout -- "$REPO_ROOT/.claude/settings.json"
echo "Restored $REPO_ROOT/.claude/settings.json from git"
