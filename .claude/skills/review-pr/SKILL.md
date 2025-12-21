---
name: review-pr
description: Review a GitHub pull request. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes.
allowed-tools: Bash(gh pr:*), mcp__github__get_issue, mcp__github__get_issue_comments, mcp__github__search_issues, mcp__github__search_code, mcp__github__get_pull_request, mcp__github__get_pull_request_files, mcp__github__get_pull_request_diff, mcp__github__get_pull_request_comments, mcp__github__get_pull_request_reviews, mcp__github__get_pull_request_status, mcp__github__list_workflow_runs, mcp__github__get_workflow_run, mcp__github__list_workflow_jobs, mcp__github__get_job_logs
---

# Review Pull Request

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
