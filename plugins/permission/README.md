# Permission

Auto-approve known-safe tool operations.

## Contents

- **Hook**: PreToolUse hook that auto-approves read-only tools and safe Bash commands

## Approved Patterns

**Read-only tools** (always approved):
- `Read`, `Glob`, `Grep`, `WebSearch`, `LS`

**Safe Bash prefixes** (approved when command starts with):
- `bun test`, `npm test`, `npx vitest`, `npx jest`
- `pytest`, `go test`, `make test`, `cargo test`

## Tmux Popup Recipe

For headless approval flows, use `claude-tmux` to auto-confirm remaining prompts in a popup:

```sh
cargo install claude-tmux
```

Bind to a tmux key (e.g., `C-b C`):

```tmux
bind C display-popup -E -w 80% -h 80% "claude-tmux"
```

## Testing

```sh
bun test plugins/permission
```
