---
description: Create a pull request in the background
allowed-tools: Bash(git:*), Bash(gh:*), Bash(glab:*), Task
---

# Create Pull Request (Background)

Create a pull request for the current branch, running the push and PR creation in the background so I can continue working. Works with GitHub and GitLab (load the `gitlab` skill for GitLab repositories).

## Capture State (Synchronous)

Before spawning any background agent, capture the current git state:

```bash
git rev-parse --show-toplevel  # Worktree/repo root
git branch --show-current      # Current branch
git rev-parse HEAD             # Current commit SHA
git status --porcelain         # Check for uncommitted changes
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'  # Base branch
```

## Handle Uncommitted Changes (Synchronous)

If `git status --porcelain` shows uncommitted changes:

1. If current branch == base branch, create and switch to a topic branch:
   - Generate a branch name based on the changes (e.g., `fix-typo`, `add-feature`)
   - `git checkout -b <topic-branch>`
2. Stage all changes: `git add -A`
3. Create a commit using the pull-request skill for message formatting
4. Capture the commit SHA and topic branch name
5. Switch back to the original branch: `git checkout <original-branch>`

**Do not background until changes are committed on a topic branch and you've returned to the original branch.**

## Spawn Background Agent

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
4. Write the PR body to `tmp/pr-body.md` following the skill format:
   - Start with 1-3 sentences summarizing the change (NO leading ## header)
   - Use `## Changes` for bulleted list of changes
   - Use `## Testing` only if tests were added or manual testing is needed
5. Create the PR: `gh pr create --base <base-branch> --head <branch> --title "..." --body-file tmp/pr-body.md`
6. Return the PR URL

## Constraints

- Do NOT make any commits - only push and create PR
- Use the captured working directory path (important for worktrees)
- MUST use `--body-file` with a temp file - heredocs fail in sandbox environments
- Follow the pull-request skill for title and body formatting
```

## Return Immediately

After spawning the background agent, inform me that:
- The PR is being created in the background
- I can continue working
- The PR URL will be available when the background task completes

If I provided arguments ($ARGUMENTS), pass them to the background agent as additional context for the PR description.
