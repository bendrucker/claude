# Bootstrapping Plugins in Remote Sessions

This guide explains how to use your custom Claude Code plugins in remote sessions (web app, VM environments).

## Quick Start

### Option 1: Run the Bootstrap Script

In any Claude Code session, run:

```bash
curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

This will:
1. Clone your marketplace repository to `~/.claude/plugins/marketplaces/bendrucker`
2. Register the marketplace in `~/.claude/plugins/known_marketplaces.json`
3. Enable core plugins in `~/.claude/settings.json`
4. Restart your session to activate plugins

### Option 2: Manual Prompt

If you prefer to do it manually or want more control, paste this into Claude:

```
Please run the following commands to install my custom plugins:

# Clone my plugins
git clone --depth 1 https://github.com/bendrucker/claude.git ~/.claude/plugins/marketplaces/bendrucker

# Register the marketplace
cat ~/.claude/plugins/known_marketplaces.json | jq '. + {"bendrucker": {"source": {"source": "git", "url": "https://github.com/bendrucker/claude.git"}, "installLocation": "/root/.claude/plugins/marketplaces/bendrucker", "lastUpdated": "'$(date -Iseconds)'"}}' > /tmp/known.json && mv /tmp/known.json ~/.claude/plugins/known_marketplaces.json

# Enable core plugins
cat ~/.claude/settings.json | jq '.enabledPlugins = (.enabledPlugins // {}) + {"github@bendrucker": true, "git@bendrucker": true, "shell@bendrucker": true, "typescript@bendrucker": true}' > /tmp/settings.json && mv /tmp/settings.json ~/.claude/settings.json
```

### Option 3: Project-Level Configuration

If you're working within a specific repository that needs certain plugins:

1. Create `.claude/settings.json` in the project:

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
    "github@bendrucker": true,
    "typescript@bendrucker": true
  }
}
```

2. On session start, ask Claude to:
   - Install the marketplace: `claude install-plugin github@bendrucker`
   - Or manually run the bootstrap script

## What Gets Installed

The bootstrap script enables these core plugins by default:

- `github@bendrucker` - GitHub CLI patterns and workflows
- `git@bendrucker` - Git workflow best practices
- `shell@bendrucker` - Shell scripting conventions
- `typescript@bendrucker` - TypeScript standards
- `python@bendrucker` - Python best practices
- `go@bendrucker` - Go language support
- `claude-code@bendrucker` - Meta-tools for Claude Code

## Customization

### Enable Additional Plugins

Edit `~/.claude/settings.json` to enable more plugins:

```json
{
  "enabledPlugins": {
    "gitlab@bendrucker": true,
    "linear@bendrucker": true,
    "terraform@bendrucker": true
  }
}
```

See the [marketplace.json](../.claude-plugin/marketplace.json) for all available plugins.

### Use Specific Plugins for a Project

Create `.claude/settings.json` in your project:

```json
{
  "enabledPlugins": {
    "python@bendrucker": true,
    "pytest@bendrucker": true
  }
}
```

## How It Works

Claude Code loads plugins from:

1. **User-level**: `~/.claude/plugins/marketplaces/{marketplace}/plugins/{plugin}`
2. **Project-level**: `./.claude/plugins/{plugin}`

The bootstrap script:
- Clones your marketplace repo to the user-level location
- Registers it in `known_marketplaces.json` so Claude knows where to find it
- Enables specific plugins in settings
- Settings changes take effect on next session restart

## Troubleshooting

### Plugins Not Working

1. Check marketplace is registered:
   ```bash
   cat ~/.claude/plugins/known_marketplaces.json
   ```

2. Check plugins are enabled:
   ```bash
   cat ~/.claude/settings.json | jq '.enabledPlugins'
   ```

3. Verify marketplace was cloned:
   ```bash
   ls -la ~/.claude/plugins/marketplaces/bendrucker
   ```

### Settings Not Taking Effect

Settings are loaded at session start. You must restart Claude Code or start a new session after running the bootstrap script.

## Creating a Session Template

For frequent use, create a project template with pre-configured settings:

```bash
# Create template
mkdir -p ~/templates/claude-project
cat > ~/templates/claude-project/.claude/settings.json <<EOF
{
  "extraKnownMarketplaces": {
    "bendrucker": {
      "source": {"source": "github", "repo": "bendrucker/claude"}
    }
  },
  "enabledPlugins": {
    "github@bendrucker": true,
    "typescript@bendrucker": true
  }
}
EOF

# Use template
cp -r ~/templates/claude-project/.claude /path/to/new/project/
```

## Future: One-Liner Bootstrap

Ideally, you'd be able to paste a single prompt at session start:

```
Please install my plugins from github.com/bendrucker/claude by running:
curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
Then restart this session.
```

Or even better, have a project-level `.claude/bootstrap.sh` that Claude runs automatically on session start (if such a hook existed).
