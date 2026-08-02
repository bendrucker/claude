# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions-monitor`: Watch a PR's CI and stream state events; invokes the logs agent on failures
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
  - `stack`: Publish and merge native stacked PRs via `gh stack link` and `gh stack merge`
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
  - `logs`: Extracts relevant lines from failing-job logs (invoked by `actions-monitor`)
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## Testing

```bash
bun test plugins/github
```
