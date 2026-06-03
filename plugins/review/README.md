# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- **`hunk`**: Core layer for reviewing changes through a live [Hunk](https://github.com/modem-dev/hunk) session in tmux. Launches and drives the session, seeds and reads back inline comments, and ships the watcher, line-mapping, and resolution-ledger helpers. `self` and `peer` delegate to it.
- **`peer`**: Review PRs when requested by a peer (GitHub or GitLab). Stages comments in Hunk for local revision, then maps and posts them as a batch.
- **`self`**: Self-review your own changes in a live Hunk session before committing. Your inline comments come back to Claude as edits to apply, or in by-hand mode Claude hands each one back and you apply it yourself.
- **`follow-up`**: Follow up on a PR/MR you reviewed: check if your comments were addressed, find silent resolves, decide whether to re-approve
- **`dashboard`**: Live tmux dashboard for reviewing inbound PRs across GitHub and GitLab

## Testing

```sh
bun test plugins/review
```
