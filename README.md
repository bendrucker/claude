# claude

A plugin marketplace for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's AI coding assistant.

## Overview

This repository provides plugins for Claude Code, organized as a plugin marketplace. Plugins extend Claude Code with language conventions, workflow automation, service integrations, and custom behaviors.

## Installation

### All Plugins (Personal Use)

Clone the repository and run the install script to symlink `.claude/` to `~/.claude`:

```bash
git clone https://github.com/bendrucker/claude.git ~/src/bendrucker/claude
cd ~/src/bendrucker/claude
./install.sh
```

The included `settings.json` enables all plugins via the local marketplace.

### Individual Plugins

Install specific plugins using Claude Code's plugin system:

```
/plugin install go@bendrucker
/plugin install terraform@bendrucker
```

Available plugins are listed in the [marketplace configuration](.claude-plugin/marketplace.json).

## Plugins

### Languages

| Plugin | Description |
|--------|-------------|
| [go](plugins/go) | Go coding standards, testing patterns, generated file hooks |
| [python](plugins/python) | Python standards, type hints, testing |
| [typescript](plugins/typescript) | TypeScript coding standards |
| [javascript](plugins/javascript) | JavaScript best practices |
| [shell](plugins/shell) | Bash scripting conventions |
| [json](plugins/json) | JSON processing with jq |
| [terraform](plugins/terraform) | Terraform configuration, CLI, modules |

### Integrations

| Plugin | Description |
|--------|-------------|
| [agents-md](https://github.com/bendrucker/claude-code-agents-md) | Automatic AGENTS.md file loading |
| [git](plugins/git) | Git workflow and branching |
| [github](plugins/github) | GitHub CLI, Actions monitoring, rulesets |
| [gitlab](plugins/gitlab) | GitLab MR workflows |
| [linear](plugins/linear) | Linear issue management |
| [things](plugins/things) | Things 3 task manager (macOS) |

### Workflows

| Plugin | Description |
|--------|-------------|
| [pull-request](plugins/pull-request) | Create PRs with proper formatting |
| [review-pr](plugins/review-pr) | Review pull requests |
| [implement-issue](plugins/implement-issue) | Implement features from tracked issues |
| [refine-issue](plugins/refine-issue) | Expand brief issues with technical context |
| [parallel-prs](plugins/parallel-prs) | Batch-process issues into draft PRs |

### Meta

| Plugin | Description |
|--------|-------------|
| [claude-code](plugins/claude-code) | Claude Code configuration and skills development |
| [newline](plugins/newline) | POSIX-compliant trailing newline management |

## Structure

```
.claude/                    # User configuration (symlinked to ~/.claude)
  ├── CLAUDE.md             # User memory
  ├── commands/             # Personal command aliases
  └── settings.json         # Plugin selection and permissions

.claude-plugin/
  └── marketplace.json      # Marketplace definition

plugins/                    # Plugin directory
  └── <plugin>/
      ├── .claude-plugin/
      │   └── plugin.json   # Plugin metadata
      ├── README.md         # Documentation
      ├── skills/           # Contextual guidance
      ├── agents/           # Custom subagents
      ├── commands/         # Slash commands
      ├── hooks/            # Tool-use interceptors
      └── scripts/          # Hook implementations

schemas/                    # JSON Schema definitions
  ├── plugin.schema.json
  └── marketplace.schema.json
```

## Creating Plugins

Each plugin requires a `.claude-plugin/plugin.json` manifest:

```json
{
  "name": "my-plugin",
  "description": "Brief description",
  "version": "1.0.0"
}
```

Plugins can include:
- **Skills** (`skills/*/SKILL.md`): Contextual guidance with activation triggers
- **Agents** (`agents/*.md`): Specialized subagents
- **Commands** (`commands/*.md`): User-invokable workflows
- **Hooks** (`hooks/hooks.json`): Pre/post-tool-use interceptors

See the [plugin schema](schemas/plugin.schema.json) for the full specification.

## Third-Party Marketplaces

Enable plugins from other marketplaces by adding them to `extraKnownMarketplaces` in your settings:

```json
{
  "extraKnownMarketplaces": {
    "astral-sh": {
      "source": { "source": "github", "repo": "astral-sh/claude-code-plugins" }
    }
  },
  "enabledPlugins": {
    "astral@astral-sh": true
  }
}
```

## License

MIT © [Ben Drucker](http://bendrucker.me)
