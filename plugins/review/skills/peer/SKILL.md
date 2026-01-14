---
name: peer
description: |
  Review a pull request when requested by a peer. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes. Supports GitHub and GitLab.
allowed-tools: Bash(gh:*), mcp__github
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
2. **Review** - Examine changed files and existing comments
3. **Think** - Evaluate against priorities (see [priorities.md](priorities.md))
4. **Suggest** - Propose comments with revisions or issues
5. **Comment** - Add approved comments to PR review
6. **Submit** - Approve / Comment / Request Changes based on severity

See [tone.md](tone.md) for comment style guidelines.

## Service Support

This skill assumes GitHub. For GitLab merge requests, load the `gitlab` skill.
