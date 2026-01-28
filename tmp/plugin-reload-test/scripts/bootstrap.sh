#!/usr/bin/env bash
# Bootstrap: install the canary plugin config mid-session
#
# This simulates what a SessionStart hook would do:
# 1. Write project-level settings enabling the canary plugin
# 2. Write user-level CLAUDE.md with a canary instruction
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS="$DIR/.claude/settings.json"
USER_DIR="$HOME/.claude"

mkdir -p "$USER_DIR"

# Write project-level settings enabling canary via plugin-dir style reference
# Since extraKnownMarketplaces only supports "github" and "url" sources,
# we write a settings.json that would work if plugins were re-resolved
cat > "$SETTINGS" << EOF
{
  "\$schema": "https://json.schemastore.org/claude-code-settings.json",
  "enabledPlugins": {
    "canary@reload-test": true
  },
  "extraKnownMarketplaces": {
    "reload-test": {
      "source": {
        "source": "github",
        "repo": "bendrucker/claude"
      }
    }
  }
}
EOF

# Write user-level CLAUDE.md as a simpler test of mid-session config pickup
cat > "$USER_DIR/CLAUDE.md" << 'EOF'
# Canary User Config

If you can see this instruction, user-level CLAUDE.md was picked up mid-session.

When asked "canary user check", respond with exactly: **CANARY_USER_MD_ALIVE**
EOF

# Write a marker file so we can verify the script ran
echo "bootstrapped at $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DIR/.bootstrap-marker"

echo "Bootstrap complete."
echo "  Project settings:  $SETTINGS"
echo "  User CLAUDE.md:    $USER_DIR/CLAUDE.md"
echo "  Marker:            $DIR/.bootstrap-marker"
