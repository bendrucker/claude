---
name: pull-request:update
description: |
  Update a pull request or merge request body to reflect the current state of changes.
  Use when a PR/MR has evolved through additional commits and the body needs to reflect what will be merged.

argument-hint: "[pr-url | mr-url]"
allowed-tools:
  - mcp__github
  - "Bash(git remote get-url:*)"
  - "Bash(gh pr:*)"
  - "Bash(glab mr:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*)"
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Arguments

`$0` (optional): the PR/MR to update, given as a URL, number, or branch name. The Workflow passes it to `gh pr view`/`glab mr view`. Default: with no argument, the tools resolve the PR/MR from the current branch.

## Context

- Remote URL: !`git remote get-url origin`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Workflow

1. **Fetch PR context**: Use `$0` (if provided) as a PR identifier (number or branch name). Fetch the current PR:
   - **GitHub**: `gh pr view $0 --json title,body,updatedAt,commits`
   - **GitLab**: `glab mr view $0`
1. **Fetch PR diff**:
   - **GitHub**: `gh pr diff $0`
   - **GitLab**: `glab mr diff $0`
1. Filter commits after `updatedAt` to identify new work since the body was last written.

## Writing

1. Rewrite the PR body per [`sections.md`](../create/references/sections.md), the same rules the create skill follows. Load the `writing` skill for the full set of tropes to avoid. If a PR template is provided in context, preserve its structure.
2. Write the updated body to a temp file (e.g., `tmp/pr-body-<branch>.md`) and apply:
   - **GitHub**: `gh pr edit --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr update --description-file tmp/pr-body-<branch>.md`

## GitLab Notes

For advanced GitLab features (username lookup), load `gitlab:merge-request`.
