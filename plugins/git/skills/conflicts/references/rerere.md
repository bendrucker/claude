# Rerere

Git's "reuse recorded resolution" remembers conflict resolutions and auto-applies them.

## Enable

```bash
git config --global rerere.enabled true
```

## How It Works

1. Resolve a conflict manually
2. Git records the resolution
3. Same conflict later: git auto-applies it
4. Verify with `git diff` before committing

## Commands

| Command | Purpose |
|---------|---------|
| `git rerere status` | Files with recorded resolutions |
| `git rerere diff` | What rerere would apply |
| `git rerere forget <file>` | Delete recorded resolution |

## Use Cases

- Repeated rebases onto updated main
- Long-running feature branches
- Backporting fixes across branches
