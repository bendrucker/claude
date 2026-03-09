---
name: pull-request:update
description: |
  Update a pull request or merge request body to reflect the current state of changes.
  Use when a PR/MR has evolved through additional commits and the body needs to reflect what will be merged.

allowed-tools:
  - mcp__github
  - "Bash(gh pr:*)"
  - "Bash(glab mr:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*:*)"
  # workaround: inline skill execution (`!` backtick) includes syntax markers in the
  # permission check pattern. Remove when the upstream bug is fixed. See #486.
  - "Bash(!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/*`:*)"
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Context

- Provider: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-provider.ts`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Workflow

1. **Fetch PR context**: Use `$0` (if provided) as a PR identifier (number or branch name). Fetch the current PR:
   - **GitHub**: `gh pr view $0 --json title,body,updatedAt,commits`
   - **GitLab**: `glab mr view $0`
1. **Fetch PR diff**:
   - **GitHub**: `gh pr diff $0`
   - **GitLab**: `glab mr diff $0`

## Analysis

1. Filter commits after `updatedAt` to identify new work since the body was last written.
2. Analyze the changes introduced by those commits.

## Writing

1. Rewrite the PR body following the same title and body rules as the create skill. If a PR template is provided in context, preserve its structure. See [`sections.md`](sections.md) for section guidance.
2. Write the updated body to a temp file (e.g., `tmp/pr-body-<branch>.md`) and apply:
   - **GitHub**: `gh pr edit --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr update --description "$(cat tmp/pr-body-<branch>.md)"`

## GitLab Notes

For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
