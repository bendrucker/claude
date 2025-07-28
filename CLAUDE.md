# Claude Code Configuration

This repository is my shared, open-source configuration for Claude Code, an AI coding assistant by Anthropic.

## Contents

- `CLAUDE.md`: Project memory file for this configuration repository
- `.claude/`: User configuration directory that gets symlinked to `~/.claude`
- `.claude/CLAUDE.md`: User memory file for Claude sessions
- `.claude/commands/`: Custom user commands directory
- `.claude/settings.json`: User settings for Claude Code
- `install.sh`: Setup script that creates symlinks from `.claude/` to `~/.claude`

## MCP Servers

- @mcps/CLAUDE.md: Managing Model Context Protocol servers

## Workflow

- The `.claude/` directory is symlinked to `~/.claude/`. New files and directories created in `.claude/` are immediately available - no need to run `./install.sh` unless the symlink itself needs to be recreated.

## Settings Configuration

The `.claude/settings.json` file contains user settings for Claude Code. Example configuration:

```json
{
  "permissions": {
    "allow": ["Bash(mkdir:*)", "WebFetch(domain:github.com)"],
    "deny": []
  }
}
```

Refer to https://docs.anthropic.com/en/docs/claude-code/settings for the full list of available settings.
