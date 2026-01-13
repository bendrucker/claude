# claude

> My personal plugin marketplace for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's AI coding assistant.

## Overview

This repository provides plugins for Claude Code, organized as a plugin marketplace. Plugins extend Claude Code with language conventions, workflow automation, service integrations, and custom behaviors.

It also contains my `settings.json` to synchronize my shared settings across machines.

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

## License

MIT © [Ben Drucker](http://bendrucker.me)
