# Claude Code Configuration

This repository is my shared, open-source configuration for Claude Code, an AI coding assistant by Anthropic.

## Contents

- `CLAUDE.md`: Project memory file for this configuration repository
- `.claude/`: User configuration directory that gets symlinked to `~/.claude`
- `.claude/CLAUDE.md`: User memory file for Claude sessions
- `.claude/commands/`: Custom user commands directory
- `install.sh`: Setup script that creates symlinks from `.claude/` to `~/.claude`

## Workflow

- When creating new files or directories in `.claude/`, run `./install.sh` to update the symlinks in `~/.claude`.

## MCP Installation

- @mcps/README.md - Instructions for adding and configuring new MCP servers
