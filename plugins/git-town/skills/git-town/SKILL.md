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

### Create a Feature Branch

```bash
git town hack feature-name
```

Creates `feature-name` from `main`, tracks the parent relationship.

### Sync Your Branch

```bash
git town sync
```

Pulls changes from the parent branch, rebases your work on top, and pushes. Run this frequently to stay current.

### Propose a PR

```bash
git town propose
```

Opens your browser to create a PR targeting the parent branch. Works across all supported platforms.

### Switch Between Branches

```bash
git town switch
```

Interactive branch switcher showing the branch hierarchy.

## Stacked Branches

Create a child branch that builds on current work:

```bash
git town append child-name
```

Creates `child-name` as a child of the current branch. When you sync, changes flow down the stack.

Navigate the stack:

```bash
git town up      # Move to child branch
git town down    # Move to parent branch
```

Sync the entire stack:

```bash
git town sync --stack
```

Propose all branches in the stack:

```bash
git town propose --stack
```

See [stacking.md](references/stacking.md) for complete stacked workflow documentation.

## Error Recovery

### Undo Any Command

```bash
git town undo
```

Reverses the last git-town command. Works for any operation.

### Continue After Conflicts

When sync encounters conflicts:

1. Resolve conflicts in your editor
2. Stage resolved files: `git add <files>`
3. Continue: `git town continue`

### Skip a Problematic Commit

If a commit can't be cleanly rebased:

```bash
git town skip
```

Skips the current commit and continues with the rest.

### Abort an Operation

```bash
git town abort
```

Cancels the in-progress operation and restores the previous state.

## Common Patterns

### Start work on a new feature

```bash
git town hack my-feature
# ... make changes, commit ...
git town sync
git town propose
```

### Update a feature with upstream changes

```bash
git town sync
```

### Create a stack of related changes

```bash
git town hack base-feature
# ... implement base ...
git town append enhancement
# ... implement enhancement ...
git town sync --stack
git town propose --stack
```

### Ship a merged branch

After a PR merges:

```bash
git town sync
```

This detects the merge and cleans up the local branch.

## Reference Documentation

- [stacking.md](references/stacking.md) - Complete stacked changes workflow
- [branch-types.md](references/branch-types.md) - Feature, perennial, contribution, and other branch types
- [commands.md](references/commands.md) - Full command reference with all flags
- [configuration.md](references/configuration.md) - Setup, preferences, multi-platform config
- [troubleshooting.md](references/troubleshooting.md) - Common issues and solutions
