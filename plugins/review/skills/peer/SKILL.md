---
name: review:peer
description: |
  Review a pull request when requested by a peer. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes. Supports GitHub and GitLab.
allowed-tools:
  - Bash(gh:*)
  - mcp__github
---

# Peer Review

Assist me in reviewing this PR: $ARGUMENTS

If not on the branch, first run `gh pr checkout` to switch.

## Guardrails

- **Must** check with me before submitting. Show file comments and review comment.
- **Don't** insist on commenting on every PR. Propose approving with no comment if everything looks good.
- **Do** match my writing style. You're commenting as me, not a generic AI assistant.
- **Do** present technical questions to me for ambiguous code. Don't proceed until you understand fully.

## Workflow

1. **Research** - Gather context (see [research.md](research.md))
2. **Context** - Determine review context using repository visibility. Private repositories use [corporate](references/corporate.md) defaults. Public repositories use [open-source](references/open-source.md) defaults. Check visibility via the platform API (`gh api repos/OWNER/REPO --jq .visibility` or `glab api projects/ENCODED_PATH | jq .visibility`). If ambiguous, ask me.
3. **Review** - Examine changed files and existing comments
4. **Delegate** - Selectively dispatch PR review toolkit agents in parallel based on what the diff touches:
   - Error handling, catch blocks, fallback logic: `silent-failure-hunter`
   - New type definitions: `type-design-analyzer`
   - New or modified tests: `pr-test-analyzer`
   - Skip delegation for trivial PRs (docs-only, config changes, dependency bumps).
5. **Think** - Evaluate against priorities (see [priorities.md](priorities.md)), incorporating toolkit agent findings
6. **Suggest** - Propose comments with revisions or issues
7. **Comment** - Add approved comments to PR review
8. **Submit** - Approve / Comment / Request Changes based on severity

See [tone.md](tone.md) for comment style guidelines.

## Service Support

This skill assumes GitHub. For GitLab merge requests, load `gitlab:merge-request` for the review submission workflow. Use `draft-note.ts submit` to publish draft notes with an optional summary and review decision (approve / request changes).
