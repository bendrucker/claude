# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skill**: Best practices for GitHub CLI and MCP tool selection
- **Agents**:
  - `github-actions-monitor`: Track workflow runs and retrieve failure logs
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## Activation

The skill activates when working with GitHub repositories, pull requests, or using `gh` CLI.

## Testing

```bash
shellspec plugins/github/spec.sh
```
