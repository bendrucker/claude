#!/usr/bin/env bash
# Reset for SessionStart experiment (web variant):
# - Installs the SessionStart hook in the REPO ROOT .claude/settings.json
#   (because Claude Code resolves settings from the git root, not cwd)
# - Removes any user-level config the hook would install
# - Clears logs
#
# Run from the repo root, not from tmp/plugin-reload-test/
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
EXPERIMENT_DIR="$REPO_ROOT/tmp/plugin-reload-test"

cat > "$REPO_ROOT/.claude/settings.json" << 'EOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/tmp/plugin-reload-test/scripts/session-start-bootstrap.sh"
          }
        ]
      }
    ]
  }
}
EOF

rm -f "$EXPERIMENT_DIR/.session-start.log"
rm -f "$HOME/.claude/CLAUDE.md"
rm -f "$HOME/.claude/settings.json"

echo "Reset complete for SessionStart experiment."
echo "  Repo settings:  $REPO_ROOT/.claude/settings.json (SessionStart hook installed)"
echo "  User config:    cleared"
echo "  Logs:           cleared"
