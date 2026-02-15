# ntfy

Push notifications via ntfy for remote Claude Code sessions.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SSH_CONNECTION` | Yes | Set automatically by SSH; notifications only fire in remote sessions |
| `NTFY_URL` | Yes | Full ntfy topic URL (e.g., `https://ntfy.sh/my-topic`) |
| `NTFY_TOKEN` | Yes | Bearer token for ntfy authentication |
| `CLAUDE_TMUX_SESSION` | No | Session name for title prefix; falls back to hostname |

## Hooks

- **Notification**: Sends notification title and message to ntfy
- **Stop**: Notifies when Claude finishes responding (low priority)
- **PermissionRequest**: Notifies when Claude is blocked waiting for approval (high priority)
- **TaskCompleted**: Notifies when a task is marked complete

All hooks exit silently when `$SSH_CONNECTION`, `$NTFY_URL`, or `$NTFY_TOKEN` is not set.

## Testing

```sh
bun test plugins/ntfy
```
