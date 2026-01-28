# Remote Session Configuration

## Problem

Remote Claude Code sessions (web, VMs) don't have access to local `~/.claude` configuration. Remote environments receive project-level configuration (`.claude/`) from the repository but lack user-level settings, plugins, and marketplace registrations that exist on your local machine.

## Bootstrap Solution

Use the bootstrap script to install your complete user configuration in remote sessions:

```
curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

The script installs:
- Marketplace registrations (bendrucker, astral-sh, ast-grep, worktrunk)
- All enabled plugins from your user configuration
- User-level instructions (CLAUDE.md)
- Permission and sandbox settings

Platform-specific settings (macOS statusLine, hooks requiring local tools) are filtered out automatically on Linux/remote platforms.

### Installation Methods

**From any remote session:**
```
Run this command: curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

**Using SessionStart hooks:**
Add to `.claude/settings.json` in repositories where you want automatic plugin installation:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash"
          }
        ]
      }
    ]
  }
}
```

This approach installs plugins automatically when remote sessions start, though the installation happens every session since remote VMs don't persist `~/.claude` between sessions.

## How Remote Configuration Works

Claude Code in remote environments:
1. Clones the repository
2. Reads project-level `.claude/settings.json` and `.claude/CLAUDE.md`
3. Executes SessionStart hooks if configured
4. Starts with an empty or default `~/.claude` directory

User-level configuration (`~/.claude/settings.json`, `~/.claude/plugins/`) from your local machine is not available. The bootstrap script populates this directory in the remote VM, but it doesn't persist between sessions.

Settings load at session initialization. Changes to settings files during a session take effect on the next user message in Agent SDK environments, or on session restart in CLI environments.

## Plugin Loading

Claude Code loads plugins from these locations in priority order:

1. Project plugins: `.claude/plugins/{plugin}`
2. Marketplace plugins: `~/.claude/plugins/marketplaces/{marketplace}/plugins/{plugin}`
3. Built-in plugins: Bundled with Claude Code

The bootstrap script installs marketplace plugins to location 2, making them available alongside project-specific and built-in plugins.

## Available Plugins

Core plugins from the bendrucker marketplace:

- **github** - GitHub CLI patterns and workflows
- **git** - Git workflow best practices
- **typescript** - TypeScript standards
- **python** - Python best practices
- **go** - Go language support
- **shell** - Shell scripting conventions
- **claude-code** - Claude Code configuration patterns
- **gitlab** - GitLab workflow and glab CLI
- **linear** - Linear issue management
- **terraform** - Terraform configuration

See [marketplace.json](.claude-plugin/marketplace.json) for the complete list.

## Troubleshooting

**Plugins not available after bootstrap:**

Check marketplace installation:
```bash
ls -la ~/.claude/plugins/marketplaces/bendrucker
```

Check marketplace registration:
```bash
jq '.bendrucker' ~/.claude/plugins/known_marketplaces.json
```

Check enabled plugins:
```bash
jq '.enabledPlugins' ~/.claude/settings.json
```

**Wrong plugin version:**

Update the marketplace:
```bash
cd ~/.claude/plugins/marketplaces/bendrucker && git pull origin main
```

**Settings don't take effect:**

Agent SDK environments: Settings reload on next user message
CLI environments: Restart the session with `claude --resume`

## Alternatives to Bootstrap Script

**Project-level marketplace configuration:**

Instead of bootstrapping user settings, configure marketplaces at the project level:

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

Commit this to `.claude/settings.json` in repositories. Plugins are available in all sessions (local and remote) without manual bootstrap.

**Template repositories:**

Create template repositories with pre-configured `.claude/settings.json` including marketplace sources and enabled plugins. Clone or fork these templates to inherit the configuration.
