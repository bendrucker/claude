#!/usr/bin/env bash
# Bootstrap script to install bendrucker plugins in remote Claude Code sessions
set -euo pipefail

REPO_URL="${1:-https://github.com/bendrucker/claude.git}"
MARKETPLACE_NAME="bendrucker"
CLAUDE_HOME="${HOME}/.claude"
MARKETPLACE_DIR="${CLAUDE_HOME}/plugins/marketplaces/${MARKETPLACE_NAME}"

echo "🔧 Bootstrapping Claude Code plugins from ${REPO_URL}"

# Clone the marketplace if not already present
if [ ! -d "${MARKETPLACE_DIR}" ]; then
    echo "📦 Cloning marketplace..."
    git clone --depth 1 "${REPO_URL}" "${MARKETPLACE_DIR}"
else
    echo "✓ Marketplace already cloned"
fi

# Update known_marketplaces.json
echo "📝 Registering marketplace..."
KNOWN_MARKETPLACES="${CLAUDE_HOME}/plugins/known_marketplaces.json"
if [ -f "${KNOWN_MARKETPLACES}" ]; then
    # Use jq to add marketplace if it doesn't exist
    jq --arg name "${MARKETPLACE_NAME}" \
       --arg url "${REPO_URL}" \
       --arg location "${MARKETPLACE_DIR}" \
       --arg updated "$(date -Iseconds)" \
       '.[$name] = {
           "source": {"source": "git", "url": $url},
           "installLocation": $location,
           "lastUpdated": $updated
       }' "${KNOWN_MARKETPLACES}" > "${KNOWN_MARKETPLACES}.tmp"
    mv "${KNOWN_MARKETPLACES}.tmp" "${KNOWN_MARKETPLACES}"
else
    # Create new file
    jq -n --arg name "${MARKETPLACE_NAME}" \
          --arg url "${REPO_URL}" \
          --arg location "${MARKETPLACE_DIR}" \
          --arg updated "$(date -Iseconds)" \
          '{($name): {
              "source": {"source": "git", "url": $url},
              "installLocation": $location,
              "lastUpdated": $updated
          }}' > "${KNOWN_MARKETPLACES}"
fi

# Enable plugins in settings
echo "⚙️  Enabling plugins..."
SETTINGS_FILE="${CLAUDE_HOME}/settings.json"
if [ -f "${SETTINGS_FILE}" ]; then
    # Add enabledPlugins section if it doesn't exist
    jq '.enabledPlugins = (.enabledPlugins // {}) + {
        "github@bendrucker": true,
        "git@bendrucker": true,
        "shell@bendrucker": true,
        "typescript@bendrucker": true,
        "python@bendrucker": true,
        "go@bendrucker": true,
        "claude-code@bendrucker": true
    }' "${SETTINGS_FILE}" > "${SETTINGS_FILE}.tmp"
    mv "${SETTINGS_FILE}.tmp" "${SETTINGS_FILE}"
else
    # Create new settings file
    cat > "${SETTINGS_FILE}" <<EOF
{
    "\$schema": "https://json.schemastore.org/claude-code-settings.json",
    "enabledPlugins": {
        "github@bendrucker": true,
        "git@bendrucker": true,
        "shell@bendrucker": true,
        "typescript@bendrucker": true,
        "python@bendrucker": true,
        "go@bendrucker": true,
        "claude-code@bendrucker": true
    }
}
EOF
fi

echo "✅ Bootstrap complete!"
echo ""
echo "Installed plugins:"
echo "  - github@bendrucker"
echo "  - git@bendrucker"
echo "  - shell@bendrucker"
echo "  - typescript@bendrucker"
echo "  - python@bendrucker"
echo "  - go@bendrucker"
echo "  - claude-code@bendrucker"
echo ""
echo "⚠️  Note: These changes will take effect in the NEXT Claude Code session"
echo "    Restart your session or start a new one to use the plugins."
