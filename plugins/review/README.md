# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- **`tuicr`**: Core layer for reviewing changes through a live [tuicr](https://github.com/agavra/tuicr) session in tmux. Discovers and drives the session, seeds and reads back inline comments, and ships the watcher, line-mapping, and resolution-ledger helpers. `self` and `peer` delegate to it.
- **`peer`**: Review PRs when requested by a peer (GitHub or GitLab). Stages comments in tuicr for local revision, then maps and posts them as a batch.
- **`self`**: Self-review your own changes in a live tuicr session before committing. Your inline comments come back to Claude as edits to apply.
- **`collect`**: Model-invocable bridge into `self`'s inbound loop. Fires when you announce mid-task that you left review comments, attaches to the already-open tuicr session, and applies and reconciles them.
- **`follow-up`**: Follow up on a PR/MR you reviewed: check if your comments were addressed, find silent resolves, decide whether to re-approve
- **`inbox`**: Dispatch inbound PR/MR reviews as background sessions that collect in `claude agents` (GitHub and GitLab)

## Testing

```sh
bun test plugins/review
```
