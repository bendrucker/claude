---
name: update
description: |
  Update a pull request or merge request body to reflect the current state of changes.
  Use when a PR/MR has evolved through additional commits and the body needs to reflect what will be merged.

allowed-tools: Bash(gh:*), Bash(git:*), Bash(glab:*), mcp__github
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Context

- Branch: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-git.sh" "$0" branch --show-current`
- PR: !`"${CLAUDE_PLUGIN_ROOT}/scripts/pr-context.sh" "$0" "${CLAUDE_SKILL_ROOT}/assets/pr-context.graphql" 2>/dev/null || echo "No PR found for current branch"`
- Diff: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-gh.sh" "$0" pr diff 2>/dev/null`

## Workflow

1. **Branch validation**: If on a default branch (main/master) and no `$0` argument was provided, stop and tell the user to specify the target branch: `/pull-request:update <branch>`. When a branch argument is provided, all git/gh commands must run in that branch's worktree using the wrapper scripts.

## Analysis

1. Filter commits after `lastEditedAt` to identify new work since the body was last written. If `lastEditedAt` is `null` (never edited), treat all commits as new work.
2. Analyze the changes introduced by those commits.

## Writing

1. Rewrite the PR body following the same title and body rules as the create skill. See [`sections.md`](sections.md) for section guidance.
2. Write the updated body to a temp file (e.g., `tmp/pr-body-<branch>.md`) and apply with `gh pr edit --body-file`.
