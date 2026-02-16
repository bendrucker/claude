---
name: pull-request:update
description: |
  Update a pull request or merge request body to reflect the current state of changes.
  Use when a PR/MR has evolved through additional commits and the body needs to reflect what will be merged.

allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/worktree/*:*), Bash(gh:*), Bash(git:*), Bash(glab:*), mcp__github
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Context

- Provider: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-provider.ts $0`
- Branch: !`${CLAUDE_PLUGIN_ROOT}/scripts/worktree/git.sh $0 branch --show-current`
- PR: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-context.ts $0`
- Diff: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-diff.ts $0`

## Workflow

1. **Branch validation**: If on a default branch (main/master) and no `$0` argument was provided, stop and tell the user to specify the target branch: `/pull-request:update <branch>`. When a branch argument is provided, all git/gh commands must run in that branch's worktree using the wrapper scripts.

## Analysis

1. Filter commits after `updatedAt` to identify new work since the body was last written.
2. Analyze the changes introduced by those commits.

## Writing

1. Rewrite the PR body following the same title and body rules as the create skill. See [`sections.md`](sections.md) for section guidance.
2. Write the updated body to a temp file (e.g., `tmp/pr-body-<branch>.md`) and apply:
   - **GitHub with `$0`**: `"${CLAUDE_PLUGIN_ROOT}/scripts/worktree/gh.sh" "$0" pr edit --body-file tmp/pr-body-<branch>.md`
   - **GitHub without `$0`**: `gh pr edit --body-file tmp/pr-body-<branch>.md`
   - **GitLab with `$0`**: `"${CLAUDE_PLUGIN_ROOT}/scripts/worktree/glab.sh" "$0" mr update --description "$(cat tmp/pr-body-<branch>.md)"`
   - **GitLab without `$0`**: `glab mr update --description "$(cat tmp/pr-body-<branch>.md)"`

## GitLab Notes

For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
