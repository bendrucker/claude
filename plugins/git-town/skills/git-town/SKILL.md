---
name: git-town
description: >-
  Branch workflow automation with git-town. Use when creating feature branches,
  syncing with upstream, proposing PRs, or managing stacked branch workflows.
allowed-tools: Bash(git town:*)
---

# git-town

git-town automates common git workflows: creating branches, syncing with upstream, and managing stacked PRs. It tracks branch relationships in git config and works with GitHub, GitLab, Bitbucket, Gitea, and Forgejo.

## Mental Model

- **Branches have parents**: Every feature branch tracks its parent (usually `main`)
- **Sync keeps you current**: Pull upstream changes, rebase your work, push results
- **Propose creates PRs**: Opens PRs targeting the correct parent branch
- **Undo is always available**: Any git-town command can be reversed

## Getting Started

Initialize git-town in a repository:

```bash
git town init
```

This walks through configuration: main branch, perennial branches, hosting platform, and sync strategy.

## Basic Workflow

```bash
git town hack feature-name  # Create feature branch from main
git town sync               # Rebase onto parent, push
git town propose            # Open PR targeting parent branch
git town switch             # Interactive branch switcher
```

## Stacked Branches

```bash
git town append child-name   # Create child of current branch
git town up                  # Move to child branch
git town down                # Move to parent branch
git town sync --stack        # Sync current branch and descendants
git town propose --stack     # Propose PRs for entire stack
```

See [stacking.md](references/stacking.md) for complete stacked workflow documentation.

## Error Recovery

```bash
git town undo      # Reverse last git-town command
git town continue  # Resume after resolving conflicts (git add first)
git town skip      # Skip problematic commit during rebase
git town abort     # Cancel operation and restore previous state
```

## Worktrees

git-town works with git worktrees. Branch metadata is stored in git config, shared across all worktrees.

**Limitation**: `git town hack --beam` may not prompt for commits when using worktrees ([#5690](https://github.com/git-town/git-town/issues/5690)). Use `git town hack` without `--beam`, then cherry-pick manually.

## Reference Documentation

- [stacking.md](references/stacking.md) - Complete stacked changes workflow
- [branch-types.md](references/branch-types.md) - Feature, perennial, contribution, and other branch types
- [commands.md](references/commands.md) - Full command reference with all flags
- [configuration.md](references/configuration.md) - Setup, preferences, multi-platform config
- [troubleshooting.md](references/troubleshooting.md) - Common issues and solutions
