---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request with proper formatting and content guidelines.
  Invoke when the user wants to create, open, or submit a PR, MR, or CR—including after committing changes.

allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*:*), Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/worktree/*:*), Bash(gh:*), Bash(git:*), Bash(glab:*), mcp__github
---

# Create Pull Request

## Context

- Provider: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-provider.ts $0`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts $0`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts $0`

## Title

- Check the log above to determine the repo's commit style:
  - **subject** (default): `${subject}: ${summary}` (e.g., `api: add timeout to request`)
  - **conventional**: `${type}: ${summary}` (e.g., `fix: add timeout to request`)
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

## Body

- Start with 1-3 sentences summarizing the change (no preceding header)
- **Wrap all code identifiers with backticks**: function names, class names, file paths, endpoints, status codes, etc.
- **Testing section**: Describe _what_ is tested, not _how many_. Never mention test counts or summarize by counting items.
- Use `##` sections for larger changes. See [`sections.md`](sections.md) for detailed guidance on:
  - `## Issue` - Root cause analysis and issue linking
  - `## Changes` - High-level description of changes
  - `## Testing` - Test coverage insights
  - `## References` - Related links and issues

## Template

When a PR template is provided in context above, follow its structure instead of the default body format:

- Preserve all template sections, even if some are left empty
- Leave checklists (checkbox items) untouched for the user to complete manually
- Remove HTML comments (`<!-- ... -->`) that serve as placeholder instructions
- Map skill-generated content into corresponding template sections:
  - Description/summary sections: use the opening summary sentences
  - Changes/what sections: use `## Changes` content from `sections.md`
  - Testing/verification sections: use `## Testing` content from `sections.md`
  - Issue/references sections: use `## Issue` and `## References` content
- For template sections with no skill equivalent (e.g., type-of-change dropdowns), fill them based on the diff context
- Within each template section, follow the style rules from `sections.md`
- If the template has a free-form description section, place the summary sentences there and add skill subsections within it as needed

When no template is detected, use the default body format from the Body section above.

## Issue Handling

When an issue is referenced:

- **ONLY reference the issue** in the PR body (e.g., `Closes #123`, `Fixes #456`)
- **NEVER modify the issue directly** - no comments, labels, milestones, or assignees

## Workflow

1. **Branch validation**: If the context shows you're on a default branch (main/master) and no `$0` argument was provided, stop and tell the user to specify the target branch: `/pull-request:create <branch>`.
2. **Worktree**: When `$0` is provided, resolve the worktree path with `bun ${CLAUDE_PLUGIN_ROOT}/scripts/worktree/resolve.ts "$0"`. Use `git -C <path>` for git commands and `cd <path>` before gh/glab commands.
3. Stage changes if not already staged: `git add .`
4. Commit if there are no commits yet on the branch. Follow the same format for the commit message as for the pull request title (conventional or subject-oriented based on repo standard): `git commit -m "..."`
5. Push the branch to remote: `git push -u origin HEAD`
6. Create the PR/MR:
   - Write the body to a temp file first (e.g., `tmp/pr-body-<branch>.md`)
   - Include the branch name in the filename to avoid conflicts with concurrent agents
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description "$(cat tmp/pr-body-<branch>.md)"`

## GitLab Notes

For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
