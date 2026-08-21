# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions-monitor`: Watch a PR's CI and stream state events; invokes the logs agent on failures
  - `attach`: Upload an image or video to GitHub's user-attachments store and reference it from an issue, PR, or comment
  - `copilot`: Cross-model review of the current diff through the Copilot CLI. Slash-invocable only, one call by default and three at most, because the Copilot plan is a fixed budget
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
  - `stack`: Build, publish, and merge native stacked PRs with the `gh stack` extension
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
  - `logs`: Extracts relevant lines from failing-job logs (invoked by `actions-monitor`)
- **Hook**: Intercepts WebFetch for efficient GitHub data access

## Testing

```bash
bun test plugins/github
```
