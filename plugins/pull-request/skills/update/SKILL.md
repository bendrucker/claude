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

Rewrite the PR/MR body so it describes what merging the current diff does. Describe the end result, and mention a change made during review only when that result is user-facing.

`$0` (optional) is a PR/MR URL, number, or branch name. With none, `gh`/`glab` resolve the PR/MR from the current branch.

## Context

- Remote URL: !`git remote get-url origin`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/sem-context.ts --stack-file "${user_config.stack_file}"`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Fetch

- GitHub: `gh pr view $0 --json title,body,updatedAt,commits` and `gh pr diff $0`
- GitLab: `glab mr view $0` and `glab mr diff $0`

Commits after `updatedAt` are the work the current body does not yet cover.

## Write

Rewrite the body per [`sections.md`](../create/references/sections.md), the rules the create skill follows, and load the `writing` skill. When a PR template is in context, keep its structure. Use the `Entities` block to judge what the change did, and lead the body with intent rather than that list.

Write the body to `tmp/pr-body-<branch>.md` and apply it:

- GitHub: `gh pr edit --body-file tmp/pr-body-<branch>.md`
- GitLab: `glab mr update --description-file tmp/pr-body-<branch>.md`

Upload any screenshot or recording the new body references by local path: `--attach ./shot.png` per file on `gh pr edit` (load `github:attach`), or project uploads per `gitlab:api` pasted in before the update. Assets already in the body keep their uploaded URLs.

For GitLab username lookup, load `gitlab:merge-request`.

Done when a fresh `gh pr view`/`glab mr view` shows the new body and it describes the work in the commits after `updatedAt`.
