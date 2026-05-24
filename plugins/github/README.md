# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions`: GitHub Actions CI/CD management via gh CLI
  - `actions-monitor`: Watch a PR's CI and stream state events; invokes the logs agent on failures
  - `gh`: Best practices for GitHub CLI and MCP tool selection
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
  - `logs`: Extracts relevant lines from failing-job logs (invoked by `actions-monitor`)
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## macOS

The `actions-monitor` watch script shells out to `gh`, which fails with `OSStatus -26276` TLS errors under macOS Seatbelt. On macOS, install the `mac` plugin alongside this one. Its sandbox hook recognizes the `claude:dangerouslyDisableSandbox` marker at the top of the watch script and disables Seatbelt for that invocation.

## Testing

```bash
bun test plugins/github
```
