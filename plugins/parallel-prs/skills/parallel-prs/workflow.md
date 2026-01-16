# Workflow

## Gather Issues

Load `github`, `gitlab`, or `linear` skill. Validate issues exist. Split into batches of 5, process sequentially.

## Clarify Requirements

Ask user upfront about approach choices, scope boundaries, and dependencies between issues.

## Plan All Issues

Plan agents (in parallel) verify file paths exist, line numbers are current, and check for conflicts between issues.

## Create Worktrees

Use worktrunk to create worktrees with proper hooks and path templates:

```bash
wt switch --create {type}/{issue-id}-{slug}
```

Worktrunk handles branch creation and worktree placement automatically based on user configuration.

## Implement in Parallel

Implementation agents work in assigned worktree, then:
1. Commit and push
2. Load `pull-request` skill and create PR (write body to `tmp/{branch}/pr-body.md` first)

## Monitor CI

Launch agent to watch for failures and report logs.
