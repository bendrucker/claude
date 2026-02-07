# Stacked Diffs

`glab stack` manages stacked diffs—small changes that build on each other while earlier ones are under review.

## Workflow

```bash
glab stack create          # Initialize a new stack
glab stack save            # Save current changes to stack
glab stack sync            # Sync with remote (rebase, push)
glab stack list            # Show all changes in stack
```

## Navigation

```bash
glab stack first           # Go to first change
glab stack last            # Go to last change
glab stack next            # Next change
glab stack prev            # Previous change
glab stack switch          # Switch between stacks
```

## Reordering

```bash
glab stack move            # Move commits within stack
glab stack reorder         # Rearrange commit sequence
glab stack amend           # Modify existing stack commits
```

## Merging a Stack

`glab stack` has no merge subcommand. Use the [stack-merge](../../scripts/stack-merge.ts) script to enable auto-merge on every MR in the stack:

```bash
bun plugins/gitlab/scripts/stack-merge.ts
```

The script reads stack refs from `.git/stacked/<title>/*.json`, checks project approval settings, and runs `glab mr merge <branch> --auto-merge -y` for each entry.

### How the cascade works

1. MR1 merges when its pipeline passes
2. GitLab auto-retargets MR2 to the base branch
3. MR2's pipeline runs — since the logical diff is unchanged, the smart patch-id reset (GitLab 16.7+) preserves approvals
4. MR2 auto-merges, triggering the same cascade for MR3, etc.

### Requirements

- **GitLab 16.7+** for smart `git patch-id` approval reset. When `reset_approvals_on_push` is enabled (the default), GitLab compares patch-ids before and after a rebase. If the logical diff is unchanged, approvals are preserved. The script checks this setting via `glab api projects/:id/approvals`.
- **Don't squash** individual stack MRs. Squash replaces the original commits with a single commit, changing the patch-id when the next MR is retargeted. This resets approvals and breaks the cascade.

Use `glab stack --help` for full options. This feature is experimental.
