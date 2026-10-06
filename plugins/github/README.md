# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions-monitor`: Watch a PR's CI and stream state events; invokes the logs agent on failures
  - `attach`: Attach an image or video to an issue, PR, comment, or review, through `gh --attach` or the user-attachments endpoint it wraps
  - `copilot`: Cross-model review of the current diff through the Copilot CLI. Slash-invocable only, one call by default and three at most, because the Copilot plan is a fixed budget
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
  - `stack`: Build, publish, and merge native stacked PRs with the `gh stack` extension
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
  - `logs`: Extracts relevant lines from failing-job logs (invoked by `actions-monitor`)
- **Hook**: Intercepts WebFetch for efficient GitHub data access
- **Mod**: [`register.ts`](mod/register.ts) watches the current branch's pull request and shows its CI and review state as a status line. A newly failed check or a review requesting changes reaches the model, and everything is logged to `mod-events`. Needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and a signed-in `gh`

## Testing

```bash
bun test plugins/github
bun scripts/mod-test.ts github
```
