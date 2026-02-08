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

Dispatch a `claude -p` CLI subprocess to each worktree (see "Worktree Dispatch" in user CLAUDE.md). Each agent:
1. Implements the plan, commits, and pushes
2. Loads `pull-request:create` skill and creates PR (writes body to `tmp/{branch}/pr-body.md` first)

## Monitor CI

Launch agent to watch for failures and report logs.
