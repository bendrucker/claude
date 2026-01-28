#!/usr/bin/env bash
# Bootstrap script to replicate bendrucker's full Claude Code user configuration
# in remote sessions (web app, VMs) where local ~/.claude isn't available
set -euo pipefail

REPO_URL="${1:-https://github.com/bendrucker/claude.git}"
MARKETPLACE_NAME="bendrucker"
CLAUDE_HOME="${HOME}/.claude"
MARKETPLACE_DIR="${CLAUDE_HOME}/plugins/marketplaces/${MARKETPLACE_NAME}"

echo "🔧 Bootstrapping Claude Code configuration from ${REPO_URL}"
echo ""

# Detect platform
PLATFORM="$(uname -s)"
IS_MACOS=false
if [ "$PLATFORM" = "Darwin" ]; then
    IS_MACOS=true
fi

# Clone the marketplace if not already present
if [ ! -d "${MARKETPLACE_DIR}" ]; then
    echo "📦 Cloning marketplace repository..."
    git clone --depth 1 "${REPO_URL}" "${MARKETPLACE_DIR}"
    echo "✓ Cloned to ${MARKETPLACE_DIR}"
else
    echo "✓ Marketplace already exists at ${MARKETPLACE_DIR}"
    echo "  Updating..."
    (cd "${MARKETPLACE_DIR}" && git pull origin main)
fi
echo ""

# Install all external marketplaces
echo "📚 Installing external marketplaces..."
EXTERNAL_MARKETPLACES=(
    "astral-sh:https://github.com/astral-sh/claude-code-plugins.git"
    "ast-grep:https://github.com/ast-grep/claude-skill.git"
    "worktrunk:https://github.com/max-sixty/worktrunk.git"
)

for marketplace in "${EXTERNAL_MARKETPLACES[@]}"; do
    name="${marketplace%%:*}"
    url="${marketplace#*:}"
    ext_dir="${CLAUDE_HOME}/plugins/marketplaces/${name}"

    if [ ! -d "${ext_dir}" ]; then
        echo "  Installing ${name}..."
        git clone --depth 1 "${url}" "${ext_dir}"
    else
        echo "  ✓ ${name} already installed"
    fi
done
echo ""

# Update known_marketplaces.json with all marketplaces
echo "📝 Registering marketplaces..."
KNOWN_MARKETPLACES="${CLAUDE_HOME}/plugins/known_marketplaces.json"

# Read existing or create empty object
if [ -f "${KNOWN_MARKETPLACES}" ]; then
    EXISTING=$(cat "${KNOWN_MARKETPLACES}")
else
    EXISTING="{}"
    mkdir -p "$(dirname "${KNOWN_MARKETPLACES}")"
fi

# Build the complete marketplace registry
cat > "${KNOWN_MARKETPLACES}" <<EOF
{
  "claude-plugins-official": $(echo "$EXISTING" | jq -r '.["claude-plugins-official"] // {
    "source": {"source": "git", "url": "https://github.com/anthropics/claude-plugins-official.git"},
    "installLocation": "'${CLAUDE_HOME}'/plugins/marketplaces/claude-plugins-official",
    "lastUpdated": "'$(date -Iseconds)'"
  }'),
  "bendrucker": {
    "source": {"source": "git", "url": "${REPO_URL}"},
    "installLocation": "${MARKETPLACE_DIR}",
    "lastUpdated": "$(date -Iseconds)"
  },
  "astral-sh": {
    "source": {"source": "git", "url": "https://github.com/astral-sh/claude-code-plugins.git"},
    "installLocation": "${CLAUDE_HOME}/plugins/marketplaces/astral-sh",
    "lastUpdated": "$(date -Iseconds)"
  },
  "ast-grep": {
    "source": {"source": "git", "url": "https://github.com/ast-grep/claude-skill.git"},
    "installLocation": "${CLAUDE_HOME}/plugins/marketplaces/ast-grep",
    "lastUpdated": "$(date -Iseconds)"
  },
  "worktrunk": {
    "source": {"source": "git", "url": "https://github.com/max-sixty/worktrunk.git"},
    "installLocation": "${CLAUDE_HOME}/plugins/marketplaces/worktrunk",
    "lastUpdated": "$(date -Iseconds)"
  }
}
EOF
echo "✓ Registered all marketplaces"
echo ""

# Build settings.json by merging user config with platform adaptations
echo "⚙️  Configuring settings..."
SETTINGS_FILE="${CLAUDE_HOME}/settings.json"
USER_SETTINGS="${MARKETPLACE_DIR}/user/settings.json"

# Read existing settings or create empty object
if [ -f "${SETTINGS_FILE}" ]; then
    EXISTING_SETTINGS=$(cat "${SETTINGS_FILE}")
else
    EXISTING_SETTINGS='{"$schema": "https://json.schemastore.org/claude-code-settings.json"}'
fi

# Merge user settings with platform-specific filtering
if [ -f "${USER_SETTINGS}" ]; then
    if [ "$IS_MACOS" = true ]; then
        # On macOS, use full user settings as-is
        cp "${USER_SETTINGS}" "${SETTINGS_FILE}"
        echo "✓ Applied full macOS configuration"
    else
        # On Linux/remote, filter out Mac-specific settings
        jq -s '
          .[0] as $existing |
          .[1] as $user |

          # Merge enabled plugins from both sources
          (($existing.enabledPlugins // {}) + $user.enabledPlugins) as $allPlugins |

          # Build final config
          {
            "$schema": "https://json.schemastore.org/claude-code-settings.json"
          }
          + (if $user.includeCoAuthoredBy != null then {includeCoAuthoredBy: $user.includeCoAuthoredBy} else {} end)
          + (if $user.alwaysThinkingEnabled != null then {alwaysThinkingEnabled: $user.alwaysThinkingEnabled} else {} end)
          + (if $user.permissions != null then {permissions: $user.permissions} else {} end)
          + {enabledPlugins: $allPlugins}
          + (if $user.extraKnownMarketplaces != null then {extraKnownMarketplaces: $user.extraKnownMarketplaces} else {} end)
          + (if $user.sandbox != null then {
              sandbox: {
                enabled: $user.sandbox.enabled,
                autoAllowBashIfSandboxed: $user.sandbox.autoAllowBashIfSandboxed,
                excludedCommands: $user.sandbox.excludedCommands
              }
            } else {} end)
          + (if $existing.hooks != null then {hooks: $existing.hooks} else {} end)
        ' <(echo "$EXISTING_SETTINGS") "${USER_SETTINGS}" > "${SETTINGS_FILE}"
        echo "✓ Applied Linux/remote configuration (filtered Mac-specific settings)"
    fi
else
    echo "⚠️  Could not find user/settings.json"
fi
echo ""

# Copy user-level CLAUDE.md instructions
echo "📄 Installing user instructions..."
USER_CLAUDE_MD="${MARKETPLACE_DIR}/user/CLAUDE.md"
if [ -f "${USER_CLAUDE_MD}" ]; then
    cp "${USER_CLAUDE_MD}" "${CLAUDE_HOME}/CLAUDE.md"
    echo "✓ Copied CLAUDE.md to ${CLAUDE_HOME}/CLAUDE.md"
else
    echo "⚠️  Could not find user/CLAUDE.md"
fi
echo ""

echo "✅ Bootstrap complete!"
echo ""
echo "📋 Configuration summary:"
echo "  • Marketplaces: bendrucker, astral-sh, ast-grep, worktrunk"
PLUGIN_COUNT=$(cat "${SETTINGS_FILE}" | jq -r '.enabledPlugins // {} | keys | length')
echo "  • Enabled plugins: ${PLUGIN_COUNT} plugins"
echo "  • Platform: ${PLATFORM} $([ "$IS_MACOS" = true ] && echo "(macOS - full config)" || echo "(Linux/remote - adapted config)")"
echo "  • User instructions: ${CLAUDE_HOME}/CLAUDE.md"
echo ""

if [ "$IS_MACOS" = false ]; then
    echo "ℹ️  Platform-specific settings filtered out:"
    echo "  • statusLine command (wt)"
    echo "  • PreToolUse hook (worktree)"
    echo "  • macOS-specific unix socket paths"
    echo ""
fi

echo "⚠️  IMPORTANT: Changes take effect on next session"
echo "    For Agent SDK/web sessions: Next user message"
echo "    For CLI sessions: Restart claude command"
echo ""
echo "🎯 Enabled plugins from bendrucker marketplace:"
cat "${SETTINGS_FILE}" | jq -r '.enabledPlugins // {} | to_entries | map(select(.value == true and (.key | contains("@bendrucker")))) | sort_by(.key) | .[] | "  • " + .key'
echo ""
echo "🌐 Enabled plugins from other marketplaces:"
cat "${SETTINGS_FILE}" | jq -r '.enabledPlugins // {} | to_entries | map(select(.value == true and (.key | contains("@bendrucker") | not))) | sort_by(.key) | .[] | "  • " + .key'
