# Workflow

## Gather Issues

Load `github`, `gitlab`, or `linear` skill. Validate issues exist. Split into batches of 5, process sequentially.

## Clarify Requirements

Ask user upfront about approach choices, scope boundaries, and dependencies between issues.

## Plan All Issues

Plan agents (in parallel) verify file paths exist, line numbers are current, and check for conflicts between issues.

## Create Worktrees

```bash
git worktree add .worktrees/{slug} -b {type}/{issue-id}-{slug} main
```

## Implement in Parallel

Implementation agents work in assigned worktree, then:
1. Commit and push
2. Load `pull-request` skill and create PR (write body to `tmp/{branch}/pr-body.md` first)

## Monitor CI

Launch agent to watch for failures and report logs.
