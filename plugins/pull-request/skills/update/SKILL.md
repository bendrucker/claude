---
name: update
description: |
  Update a pull request or merge request body to reflect the current state of changes.
  Use when a PR/MR has evolved through additional commits and the body needs to reflect what will be merged.

allowed-tools: Bash(gh:*), Bash(git:*), Bash(glab:*), mcp__github
---

# Update Pull Request

The PR body documents what will happen when merged, not the journey. Don't echo review feedback. Only mention changes if the ultimate result is user-facing.

## Workflow

1. Identify the PR number from the current branch:
   ```
   gh pr view --json number --jq '.number'
   ```
2. Get the repo owner and name:
   ```
   gh repo view --json owner,name --jq '[.owner.login, .name] | join(" ")'
   ```
3. Fetch PR context via GraphQL using [`assets/pr-context.graphql`](assets/pr-context.graphql):
   ```
   gh api graphql -F owner=OWNER -F repo=REPO -F number=NUMBER -f query="$(cat assets/pr-context.graphql)"
   ```
4. Filter commits after `lastEditedAt` to identify new work since the body was last written. If `lastEditedAt` is `null` (never edited), treat all commits as new work.
5. Analyze the changes introduced by those commits.
6. Rewrite the PR body following the same title and body rules as the create skill. See [`sections.md`](sections.md) for section guidance.
7. Write the updated body to a temp file and apply:
   ```
   gh pr edit NUMBER --body-file tmp/pr-body-<branch>.md
   ```
