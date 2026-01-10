# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `plugins/`: Plugins providing language support, workflows, and integrations
- `.claude-plugin/marketplace.json`: Marketplace definition listing all available plugins
- `schemas/`: JSON Schema definitions for `plugin.schema.json` and `marketplace.schema.json`
- `.claude/`: My personal configuration directory, symlinked to `~/.claude`
- `install.sh`: Setup script that creates symlinks from `.claude/` to `~/.claude`

## Plugin Architecture

Each plugin in `plugins/` contains:
- `.claude-plugin/plugin.json`: Plugin metadata
- `skills/`: Skill definitions with `SKILL.md` and reference files
- `hooks/`: Optional hook definitions (`hooks.json`)
- `commands/`: Optional slash commands
- `agents/`: Optional agent definitions

## Workflow

- The `.claude/` directory is symlinked to `~/.claude/`. New files are immediately available without re-running `install.sh`.
- Plugin changes take effect immediately in new Claude sessions.

## Settings

My `.claude/settings.json` enables all plugins from this marketplace plus third-party plugins. See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.
