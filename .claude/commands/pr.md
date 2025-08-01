---
description: Create a GitHub pull request
allowed-tools: Bash(gh:*), mcp__github
argument-hint: [title]
---
## Context

- Current git status: !`git status`
- Current git diff: !`git diff --staged HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Task

- Create a pull request from my staged changes and any recent commits to the current branch if not on a default branch.
- Request title (generate if not provided): $ARGUMENTS
- **Do not** commit any unstaged changes.
- If I am on a default branch, create a branch first, named based on the subject/type of my changes.
  - Example: fix/add-timeout-to-request
  - Example: aws-provider-v6
  - Example: refactor-user-service
- Commit first if there are no staged changes. Follow the same format for the commit message as for the pull request title.
- Follow instructions in @../memory/tasks/pull-request.md.

