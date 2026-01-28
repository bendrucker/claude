# Using Plugins in Remote Claude Code Sessions

## The Problem

When using Claude Code on the web or in remote VMs, your local `~/.claude` configuration and plugins aren't available. Project-level skills (`.claude/skills/`) work, but user-level plugins and marketplace installations don't transfer.

## Solutions

### 🚀 Quick Start: One-Liner Bootstrap (Recommended)

Paste this at the start of any Claude Code session:

```
Run this command to install my plugins: curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

After Claude runs it, restart the session to activate plugins.

### 📋 Manual Commands (More Control)

If you prefer step-by-step control:

```bash
# 1. Clone marketplace
git clone --depth 1 https://github.com/bendrucker/claude.git \
  ~/.claude/plugins/marketplaces/bendrucker

# 2. Register marketplace
jq '. + {
  "bendrucker": {
    "source": {"source": "git", "url": "https://github.com/bendrucker/claude.git"},
    "installLocation": "'$HOME'/.claude/plugins/marketplaces/bendrucker",
    "lastUpdated": "'$(date -Iseconds)'"
  }
}' ~/.claude/plugins/known_marketplaces.json > /tmp/known.json
mv /tmp/known.json ~/.claude/plugins/known_marketplaces.json

# 3. Enable plugins
jq '.enabledPlugins = (.enabledPlugins // {}) + {
  "github@bendrucker": true,
  "git@bendrucker": true,
  "typescript@bendrucker": true,
  "shell@bendrucker": true
}' ~/.claude/settings.json > /tmp/settings.json
mv /tmp/settings.json ~/.claude/settings.json
```

### 🎯 Project-Specific Plugins

For projects that need specific plugins, add `.claude/settings.json`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "extraKnownMarketplaces": {
    "bendrucker": {
      "source": {
        "source": "github",
        "repo": "bendrucker/claude"
      }
    }
  },
  "enabledPlugins": {
    "typescript@bendrucker": true,
    "github@bendrucker": true
  }
}
```

Then install at session start:
```
Install my plugins: bash ~/.claude/plugins/marketplaces/bendrucker/scripts/bootstrap-remote.sh
```

### 🔧 In-Repo Bootstrap

When working in the `bendrucker/claude` repo itself (like this session), you can use the local copy:

```bash
# Create symlink to local repo
ln -s /home/user/claude ~/.claude/plugins/marketplaces/bendrucker

# Register it
jq '. + {
  "bendrucker": {
    "source": {"source": "git", "url": "file:///home/user/claude"},
    "installLocation": "'$HOME'/.claude/plugins/marketplaces/bendrucker",
    "lastUpdated": "'$(date -Iseconds)'"
  }
}' ~/.claude/plugins/known_marketplaces.json > /tmp/known.json
mv /tmp/known.json ~/.claude/plugins/known_marketplaces.json

# Enable plugins
jq '.enabledPlugins = {"github@bendrucker": true}' ~/.claude/settings.json > /tmp/settings.json
mv /tmp/settings.json ~/.claude/settings.json
```

## How It Works

Claude Code loads plugins from three locations (in priority order):

1. **Project plugins**: `.claude/plugins/{plugin}`
2. **Marketplace plugins**: `~/.claude/plugins/marketplaces/{marketplace}/plugins/{plugin}`
3. **Built-in plugins**: Bundled with Claude Code

The bootstrap process:
1. Clones your marketplace repo to `~/.claude/plugins/marketplaces/bendrucker`
2. Registers it in `~/.claude/plugins/known_marketplaces.json`
3. Enables specific plugins in `~/.claude/settings.json`

**Important**: Settings are loaded at session start, so you must restart after bootstrapping.

## Available Plugins

See [marketplace.json](.claude-plugin/marketplace.json) for the full list. Core plugins:

- **github** - GitHub CLI patterns and workflows
- **git** - Git workflow best practices
- **typescript** - TypeScript standards
- **python** - Python best practices
- **go** - Go language support
- **shell** - Shell scripting conventions
- **claude-code** - Meta-tools for Claude Code configuration
- **gitlab** - GitLab workflow and glab CLI
- **linear** - Linear issue management
- **terraform** - Terraform configuration and providers

## Workflow Examples

### Starting a New Remote Project

```
1. Start Claude Code session
2. Paste: "Run: curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash"
3. Wait for installation
4. Restart session
5. Verify: Check that skills are available
```

### Working in an Existing Project

If the project has `.claude/settings.json` with marketplace config:

```
1. Start session
2. Paste: "Install plugins from .claude/settings.json"
3. Restart session
```

### One-Off Plugin Use

Don't need plugins permanently? Use project-level config:

```bash
mkdir -p .claude
cat > .claude/settings.json <<EOF
{
  "extraKnownMarketplaces": {
    "bendrucker": {"source": {"source": "github", "repo": "bendrucker/claude"}}
  },
  "enabledPlugins": {"typescript@bendrucker": true}
}
EOF
```

## Troubleshooting

### Plugins Not Available

Check each step:

```bash
# 1. Marketplace cloned?
ls -la ~/.claude/plugins/marketplaces/bendrucker

# 2. Marketplace registered?
jq '.bendrucker' ~/.claude/plugins/known_marketplaces.json

# 3. Plugins enabled?
jq '.enabledPlugins' ~/.claude/settings.json

# 4. Did you restart the session?
```

### Wrong Plugin Version

Update the marketplace:

```bash
cd ~/.claude/plugins/marketplaces/bendrucker
git pull origin main
```

### Conflicts with Local Plugins

Project settings override user settings. Check `.claude/settings.json` for conflicting config.

## Future Improvements

Ideas for making this smoother:

1. **Session init hook**: Auto-run bootstrap on session start if `.claude/bootstrap.sh` exists
2. **Built-in marketplace**: Include `bendrucker` marketplace in Claude Code defaults
3. **Settings inheritance**: Allow user settings to be stored in a gist/repo and auto-loaded
4. **One-command install**: `claude bootstrap bendrucker` to install marketplace + core plugins
5. **Session templates**: Save/restore complete session configurations

## Template: Bootstrap Prompt

Save this as a snippet for quick pasting:

```
Please install my Claude Code plugins by running:

curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash

This will:
- Clone my marketplace from github.com/bendrucker/claude
- Register it in ~/.claude/plugins/known_marketplaces.json
- Enable core plugins (github, git, typescript, python, go, shell, claude-code)

After it completes, I'll restart the session to activate the plugins.
```
