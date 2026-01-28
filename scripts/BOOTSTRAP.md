# Bootstrap Script

The bootstrap script installs your complete Claude Code configuration in remote sessions (web, VMs) where local `~/.claude` settings aren't available.

## Usage

```bash
curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

The script installs:
- Marketplace registrations (bendrucker, astral-sh, ast-grep, worktrunk)
- All enabled plugins from `user/settings.json`
- User-level instructions from `user/CLAUDE.md`
- Permission and sandbox settings
- Platform-specific filtering (removes macOS-only settings on Linux)

## Installation

**From Claude Code session:**

Paste this prompt:
```
Run this command: curl -fsSL https://raw.githubusercontent.com/bendrucker/claude/main/scripts/bootstrap-remote.sh | bash
```

**Automatic installation with SessionStart hooks:**

Add to `.claude/settings.json` in repositories:

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

The hook runs on session start, installing plugins automatically. Note that remote VMs don't persist `~/.claude` between sessions, so the hook runs on every session start.

## What Gets Installed

Default enabled plugins:
- `github@bendrucker` - GitHub CLI patterns
- `git@bendrucker` - Git workflows
- `typescript@bendrucker` - TypeScript standards
- `python@bendrucker` - Python conventions
- `go@bendrucker` - Go language support
- `shell@bendrucker` - Shell scripting
- `claude-code@bendrucker` - Claude Code configuration

Plus all other plugins enabled in `user/settings.json`.

See [marketplace.json](../.claude-plugin/marketplace.json) for the complete plugin list.

## How It Works

The script:
1. Clones the marketplace repository to `~/.claude/plugins/marketplaces/bendrucker`
2. Installs external marketplaces (astral-sh, ast-grep, worktrunk)
3. Registers all marketplaces in `~/.claude/plugins/known_marketplaces.json`
4. Merges user settings with any existing remote settings
5. Copies user-level CLAUDE.md

On Linux/remote platforms, the script filters out macOS-specific settings:
- `statusLine` command configuration
- `PreToolUse` hooks requiring local macOS tools
- macOS-specific network socket paths

## Settings Reload

Settings load at session initialization:
- **Agent SDK/web sessions**: Settings take effect on next user message
- **CLI sessions**: Restart required with `claude --resume`

## Troubleshooting

**Marketplace not found:**
```bash
ls -la ~/.claude/plugins/marketplaces/bendrucker
```

**Marketplace not registered:**
```bash
jq '.bendrucker' ~/.claude/plugins/known_marketplaces.json
```

**Plugins not enabled:**
```bash
jq '.enabledPlugins' ~/.claude/settings.json
```

**Update marketplace to latest version:**
```bash
cd ~/.claude/plugins/marketplaces/bendrucker && git pull origin main
```

## Project-Level Alternative

Instead of bootstrapping user settings, configure marketplaces at the project level in `.claude/settings.json`:

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

Commit this configuration to repositories. Plugins are available in all sessions (local and remote) without manual bootstrap.
