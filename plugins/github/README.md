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
- **Mod**: [`register.ts`](mod/register.ts) watches the current branch's pull request and shows its CI and review state as a status line

## PR Watch Mod

The mod runs only under `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, in interactive sessions, with `gh` on `PATH` and signed in. It depends on the `mod-events` plugin for its event log. Without `gh` it records `session.start` with `active: false` and stays idle.

It polls `gh pr view` for the branch in the session's working directory: every minute while checks run, every three minutes once they settle, and never on `main`, `master`, or a detached `HEAD`. A newly failed check, or a review requesting changes, reaches the model as a message from the plugin. Every other change only updates the status line. Each promotion, drop, and injection is logged to `mod-events` under `github`.

## Testing

```bash
bun test plugins/github
bun scripts/mod-test.ts github
```
