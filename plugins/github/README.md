# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `gh`: Best practices for GitHub CLI and MCP tool selection
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
- **Agents**:
  - `github-actions-monitor`: Track workflow runs and retrieve failure logs
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## Testing

```bash
npm test -- plugins/github
```
