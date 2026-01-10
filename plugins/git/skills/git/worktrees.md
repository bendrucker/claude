# Git Worktrees

When the user asks to start a worktree for a task:

1. **Location**: Create worktrees in `.worktrees/` subdirectory within the repository
2. **Naming**: Generate a short, hyphenated slug from the task description (e.g., "fix-auth-bug", "add-logging")
3. **Base branch**: Always branch from the default branch (main/master)
4. **Cleanup**: Proactively offer to remove worktrees after the associated PR is merged or work is complete

## Workflow

```bash
# Create worktree
git worktree add .worktrees/<slug> -b <branch-name>

# List worktrees
git worktree list

# Remove worktree (when done)
git worktree remove .worktrees/<slug>
```

## Example

User: "start a worktree to work on fixing authentication bug"

```bash
git worktree add .worktrees/fix-auth-bug -b fix-auth-bug
```
