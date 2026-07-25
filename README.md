# claude

> My personal plugin marketplace for [Claude Code](https://code.claude.com/docs), Anthropic's AI coding assistant.

## Overview

This repository provides plugins for Claude Code, organized as a plugin marketplace. Plugins extend Claude Code with language conventions, workflow automation, service integrations, and custom behaviors.

It also contains my user configuration.

## Prerequisites

Many plugins include TypeScript hooks and scripts that require [Bun](https://bun.sh) to run. See [Bun's installation guide](https://bun.sh/docs/installation) for setup instructions. Bun runs TypeScript natively and auto-installs missing dependencies on first run.

## Plugins

Browse the [`plugins/`](plugins/) directory to see available plugins. Each plugin has its own README describing its contents.

## User

The [`user/`](user/) directory contains user-level Claude Code configuration that gets symlinked to `~/.claude`. This includes global instructions, settings (plugins, permissions, sandbox), and hooks that apply across all projects.

## Development

To test a plugin locally without publishing:

```bash
claude --plugin-dir ./plugins/<name> --setting-sources local
```

This isolates the session from user/project settings, loading only the specified plugin. Use this to verify changes before committing.

## License

MIT © [Ben Drucker](http://bendrucker.me)
