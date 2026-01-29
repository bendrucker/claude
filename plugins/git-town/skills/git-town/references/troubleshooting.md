# Troubleshooting

## Conflict Resolution

When sync encounters conflicts:

1. Resolve conflicts in files
2. Stage: `git add <files>`
3. Continue: `git town continue`

Alternatives:
- `git town skip` - skip the problematic commit (when obsolete)
- `git town abort` - restore state before operation

## Undo Operations

```bash
git town undo  # Reverse last command (repeatable)
```

`undo` reverses branch changes, commits, and config. Cannot reverse manual git commands or remote pushes.

## Common Errors

| Error | Solution |
|-------|----------|
| "Branch has uncommitted changes" | `git stash`, run command, `git stash pop` |
| "Cannot sync contribution branch" | Expected - use `git push` manually |
| "Branch has no parent" | `git town set-parent main` |
| "Push rejected: non-fast-forward" | `git town sync` (pulls and rebases) |
| "Cannot determine hosting platform" | `git town config hosting-platform github` |

## Stack Issues

```bash
git town swap          # Reorder: swap with parent
git town set-parent    # Reorder: choose new parent
git town detach        # Detach: make direct child of main
```

## Sync Issues

**Not pushing**: Check branch type with `git town branch`, toggle off `prototype` or `contribute`

**Skipping branch**: `git town unpark`

**Wrong strategy**: `git town config sync-feature-strategy rebase`

## Platform Issues

PR creation failing: verify authentication with `gh auth status` or `glab auth status`

Wrong PR target: `git town set-parent correct-parent`

## Recovery

```bash
git town abort          # Stuck in rebase
git rebase --abort      # Fallback if abort fails
git reflog              # Lost branch - find commit SHA
git town config reset   # Corrupted state - then re-run init
```

## Debug

```bash
GIT_TOWN_DEBUG=true git town sync
git town help <command>
```
