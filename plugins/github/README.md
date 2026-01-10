# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Features

- **GitHub Skill**: Best practices for GitHub CLI and MCP tool selection
- **Actions Monitor Agent**: Track GitHub Actions workflow runs and retrieve failure logs
- **Rulesets Manager Agent**: Configure repository rulesets and branch protection

## Installation

Add the plugin to your Claude Code configuration:

```json
{
  "plugins": [
    "bendrucker/claude#plugins/github"
  ]
}
```

## Contents

- `skills/github/`: GitHub workflow best practices
- `agents/`: Specialized agents for Actions monitoring and rulesets management
- `hooks/`: WebFetch interceptor for efficient GitHub data access
- `scripts/`: Hook implementation scripts
