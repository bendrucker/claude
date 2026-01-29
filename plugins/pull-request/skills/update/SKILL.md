---
name: update
description: |
  Update a pull request body to reflect the current state of changes. Use when a PR has evolved
  through additional commits and the body needs to reflect what will be merged.
allowed-tools: Bash(gh:*), Bash(git:*), mcp__github
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Context

- Branch: !`git branch --show-current`
- PR: !`gh api graphql -F owner="$(gh repo view --json owner --jq '.owner.login')" -F repo="$(gh repo view --json name --jq '.name')" -F number="$(gh pr view --json number --jq '.number')" -f query="$(cat ${CLAUDE_SKILL_ROOT}/assets/pr-context.graphql)" 2>/dev/null || echo "No PR found for current branch"`
- Diff: !`gh pr diff 2>/dev/null`

## Analysis

1. Filter commits after `lastEditedAt` to identify new work since the body was last written. If `lastEditedAt` is `null` (never edited), treat all commits as new work.
2. Analyze the changes introduced by those commits.

## Writing

1. Rewrite the PR body following the same title and body rules as the create skill. See [`sections.md`](sections.md) for section guidance.
2. Write the updated body to a temp file (e.g., `tmp/pr-body-<branch>.md`) and apply with `gh pr edit --body-file`.
