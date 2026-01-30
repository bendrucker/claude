---
name: create
description: |
  Create a pull request, merge request, or change request with proper formatting and content guidelines.
  Invoke when the user wants to create, open, or submit a PR, MR, or CR—including after committing changes.

allowed-tools: Bash(gh:*), Bash(git:*), Bash(glab:*), mcp__github
---

# Create Pull Request

## Context

- Branch: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-git.sh" "$0" branch --show-current`
- Status: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-git.sh" "$0" status --short`
- Log: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-git.sh" "$0" log --oneline -20`
- Diff: !`"${CLAUDE_PLUGIN_ROOT}/scripts/wt-git.sh" "$0" diff HEAD`

## Title

- Check the log above to determine the repo's commit style:
  - **subject** (default): `${subject}: ${summary}` (e.g., `api: add timeout to request`)
  - **conventional**: `${type}: ${summary}` (e.g., `fix: add timeout to request`)
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

## Body

- Start with 1-3 sentences summarizing the change (no preceding header)
- **Wrap all code identifiers with backticks**: function names, class names, file paths, endpoints, status codes, etc.
- Use `##` sections for larger changes. See [`sections.md`](sections.md) for detailed guidance on:
  - `## Issue` - Root cause analysis and issue linking
  - `## Changes` - High-level description of changes
  - `## Testing` - Test coverage insights
  - `## References` - Related links and issues

## Issue Handling

When an issue is referenced:

- **ONLY reference the issue** in the PR body (e.g., `Closes #123`, `Fixes #456`)
- **NEVER modify the issue directly** - no comments, labels, milestones, or assignees

## Workflow

1. **Branch validation**: If the context shows you're on a default branch (main/master) and no `$0` argument was provided, stop and tell the user to specify the target branch: `/pull-request:create <branch>`. When a branch argument is provided, all git/gh commands must run in that branch's worktree using the wrapper scripts.
2. Stage changes if not already staged.
3. Commit if there are no commits yet on the branch. Follow the same format for the commit message as for the pull request title (conventional or subject-oriented based on repo standard).
4. Push the branch to remote.
5. Create the pull request:
   - Write the PR body to a temp file first (e.g., `tmp/pr-body-<branch>.md`)
   - Use `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - Include the branch name in the filename to avoid conflicts with concurrent agents
   - This avoids escaping issues with heredocs in shell commands
