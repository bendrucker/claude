---
name: parallel-prs
description: Batch-process multiple issues into draft PRs using parallel worktrees. Use when implementing several related issues simultaneously, creating multiple PRs in parallel, or batch-processing a backlog.
allowed-tools: Bash(git:*), Bash(gh:*), Bash(wt:*)
---

# parallel-prs

## Constraints

- **Batch size**: 5 issues max (larger batches split automatically)
- **No worktree cleanup**: PRs may need iteration after CI feedback
- **Issue linking**: `Closes #123` in PR body (not commit)

## Workflow

1. Load `linear`, `github`, or `gitlab` skill; fetch issue details
2. Ask user to clarify ambiguities upfront
3. Plan agents verify paths/line numbers in parallel
4. Create worktrees with `wt switch --create`
5. Implementation agents commit, push, load `pull-request` skill, create PR
6. Monitor CI for failures

See [workflow.md](workflow.md) and [agents.md](agents.md).
