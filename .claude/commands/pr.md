---
description: Create a pull request in the background
allowed-tools: Bash(git:*), Bash(gh:*), Bash(glab:*), Task
---

# Create Pull Request (Background)

Create a pull request for the current branch, running the push and PR creation in the background so I can continue working. Works with GitHub and GitLab (load the `gitlab` skill for GitLab repositories).

## Phase 1: Capture State (Synchronous)

Before spawning any background agent, capture the current git state:

```bash
git rev-parse --show-toplevel  # Worktree/repo root
git branch --show-current      # Current branch
git rev-parse HEAD             # Current commit SHA
git status --porcelain         # Check for uncommitted changes
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'  # Base branch
```

## Phase 2: Handle Uncommitted Changes (Synchronous)

If `git status --porcelain` shows uncommitted changes:

1. Stage all changes: `git add -A`
2. Create a commit using the pull-request skill for message formatting
3. Re-capture the commit SHA after committing

**Do not background until all changes are committed.** The commit is the fork point.

## Phase 3: Spawn Background Agent

Use the Task tool with `run_in_background: true` and `subagent_type: "general-purpose"`.

Pass this prompt to the agent, substituting the captured values:

```
Create a pull request with the following pre-captured state:

- Working directory: <captured worktree root>
- Branch: <captured branch name>
- Commit SHA: <captured commit SHA>
- Base branch: <captured base branch>

## Instructions

1. Change to the working directory
2. Push the branch: `git push -u origin <branch>`
3. Load the pull-request skill for formatting guidelines
4. Create the PR with `gh pr create --base <base-branch>`
5. Return the PR URL

## Constraints

- Do NOT make any commits - only push and create PR
- Use the captured working directory path (important for worktrees)
- Follow the pull-request skill for title and body formatting
```

## Phase 4: Return Immediately

After spawning the background agent, inform me that:
- The PR is being created in the background
- I can continue working
- The PR URL will be available when the background task completes

If I provided arguments ($ARGUMENTS), pass them to the background agent as additional context for the PR description.
