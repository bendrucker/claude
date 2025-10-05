# claude

My personal configuration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's AI coding assistant.

## Overview

This repository contains my shared, open-source configuration that customizes Claude Code's behavior across all my projects. It includes user instructions, tool preferences, language conventions, and workflow guidelines.

## Setup

The [install](./install.sh) script symlinks each file in the `.claude` directory into `~/.claude`. It asks to overwrite existing files but skips any links that already exist. It can be run idempotently.

```bash
./install.sh
```

## Structure

- `.claude/` - User configuration directory
  - `CLAUDE.md` - [User memory](https://docs.anthropic.com/en/docs/claude-code/memory#memory-best-practices). Index for `memory/`, where each file represents a specific topic.
  - `memory/` - Organized guidelines by category
    - `tasks/` - Common task templates
    - `tools/` - Tool usage instructions
    - `languages/` - Language-specific conventions
  - `commands/` - [Personal commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands#personal-commands)
  - `hooks/` - [Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) for customizing Claude Code behavior

## Usage

Once installed, Claude Code will automatically use these configurations in any project.

## License

MIT © [Ben Drucker](http://bendrucker.me)
