#!/usr/bin/env bash
# SessionStart hook: install user config before first user turn
#
# This runs at session startup, before Claude processes any user input.
# We test whether plugins configured here are available in the first turn.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
EXPERIMENT_DIR="$REPO_ROOT/tmp/plugin-reload-test"
USER_DIR="$HOME/.claude"
LOGFILE="$EXPERIMENT_DIR/.session-start.log"

mkdir -p "$USER_DIR"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOGFILE"
}

log "SessionStart hook fired"
log "CLAUDE_CODE_REMOTE=${CLAUDE_CODE_REMOTE:-unset}"
log "CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-unset}"

# Write user-level CLAUDE.md
cat > "$USER_DIR/CLAUDE.md" << 'USERMD'
# Canary User Config (SessionStart)

If you can see this instruction, user-level CLAUDE.md installed by a SessionStart hook was picked up.

When asked "canary user check", respond with exactly: **CANARY_USER_MD_ALIVE**
USERMD
log "Wrote $USER_DIR/CLAUDE.md"

# Write user-level settings enabling the canary plugin
cat > "$USER_DIR/settings.json" << 'USERSETTINGS'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
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
USERSETTINGS
log "Wrote $USER_DIR/settings.json"

# Persist env vars if CLAUDE_ENV_FILE is available
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CANARY_BOOTSTRAP=true" >> "$CLAUDE_ENV_FILE"
  log "Wrote CANARY_BOOTSTRAP to CLAUDE_ENV_FILE"
fi

log "SessionStart hook complete"
echo "SessionStart bootstrap complete"
