---
name: worktrees
description: |
  Managing git worktrees for parallel development. Use when the user mentions "worktree", "worktrees", "work tree", "work trees", "git worktree", wants to work on multiple branches simultaneously, asks about parallel development workflows, or wants to start isolated work on a task.
---

# Git Worktrees

Create and manage git worktrees for parallel development.

## Creating a Worktree

When starting a worktree:

1. **Location**: Create in `.worktrees/` subdirectory within the repository
2. **Naming**: Use a short, hyphenated slug from the task (e.g., `fix-auth-bug`, `add-logging`)
3. **Base branch**: Always branch from the default branch (main/master)

```bash
# Ensure you're on the default branch first
git checkout main

# Create worktree with a new branch
git worktree add .worktrees/<slug> -b <branch-name>
```

## Branch Naming

Use the same name for the worktree directory and branch:

```bash
git worktree add .worktrees/fix-auth-bug -b fix-auth-bug
```

## Managing Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree (after PR is merged)
git worktree remove .worktrees/<slug>

# Prune stale worktree references
git worktree prune
```

## Cleanup

After a PR is merged:

1. Remove the worktree: `git worktree remove .worktrees/<slug>`
2. Delete the local branch: `git branch -d <branch-name>`
3. Prune if needed: `git worktree prune`

Proactively offer cleanup when:
- Work on the task is complete
- The associated PR is merged
- The user asks to list worktrees and some appear stale
