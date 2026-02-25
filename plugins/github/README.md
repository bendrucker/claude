# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions`: GitHub Actions CI/CD management via gh CLI
  - `actions-monitor`: Monitor workflow runs and extract failure diagnostics
  - `gh`: Best practices for GitHub CLI and MCP tool selection
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## Testing

```bash
bun test plugins/github
```
