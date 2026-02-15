# tmux

tmux integration for bell notifications, status updates, and session context.

## Hooks

- **SessionStart**: Captures tmux session, window, and pane info into environment variables
- **Notification**: Sends a bell character to `/dev/tty` for tmux alert triggers
- **Stop**: Sets `@claude_status` pane variable to `done` or `idle`
- **SessionEnd**: Clears `@claude_*` pane variables

All hooks exit silently when `$TMUX` is not set.

## Testing

```sh
bun test plugins/tmux
```
