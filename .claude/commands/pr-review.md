---
description: Review a GitHub pull request
allowed-tools: Bash(gh pr list), Bash(gh pr view), Bash(gh pr checkout), mcp__github__get_issue, mcp__github__get_issue_comments, mcp__github__search_issues, mcp__github__search_code, mcp__github__get_pull_request, mcp__github__get_pull_request_files, mcp__github__get_pull_request_diff, mcp__github__get_pull_request_comments, mcp__github__get_pull_request_reviews, mcp__github__get_pull_request_status, mcp__github__list_workflow_runs, mcp__github__get_workflow_run, mcp__github__list_workflow_jobs, mcp__github__get_job_logs
---

# Review Pull Request

Assist me in reviewing this pull request (PR): $ARGUMENTS

If I am not already on that branch, your first step should be to use `gh pr checkout` to switch to the branch associated with the PR.

## Guardrails

- You **must** check with me before submitting a review. Show me both the file comments and the review comment.
- **Don't** insist on commenting on every PR. If everything looks good, propose approving with no comment, or a friendly compliment.
- **Do** match my [writing style](#tone) in comments. You are commenting as me and should **not** write like a generic AI code review assistant.
- **Do** present technical questions to me given ambiguous code. **Don't** proceed until you understand the issue and proposed change fully.

## Workflow

1. **Research** the proposed changes and gather context about the intent and implementation details. 
2. **Review** the changed files in the PR as well as any existing review comments. 
3. **Think** about how the change files implement the desired change and whether changes are needed. 
4. **Suggest** any comments I should add with suggested revisions or issues.
5. **Comment** on each range where I approve a comment in a PR review.
6. **Submit** the review.
   - **Approve** if the pull request is good to merge, even if I’ve left some minor comments.
   - **Comment** if the pull request has some issues and I’m not ready to approve, but no issue is critical. 
   - **Request Changes** if the pull request has important issues that must be addressed before merge.

## Research

- [ ] If any issues are referenced in the body, fetch their content and any comments with the `github` MCP. 
- [ ] If any URLs are referenced in the body, fetch their content with `WebFetch`.
- [ ] If you believe there is not sufficient context in the pull request body about the motivation or implementation, ask me to provide additional information.

## Priorities

Prioritize these areas in order when making comments.

1. **Bugs:** Any issue that could cause the program to behave unexpectedly or crash. 
2. **Performance:** Inefficient approaches that may consume excess resources or add latency.
3. **Architecture:** modules should be well organized and interfaces carefully designed to separate concerns. Utilities and other “miscellany” packages should be avoided.
4. **Style:** deviations from project or language style should be noted, but limited. Prefer automated linting to reviews for style enforcement. If possible, suggest that enforcement to *me* instead of commenting on the pull request.

Think hard about the problem the pull request is trying to solve and whether the approach it takes is the best one.

## Tone

Review comments should be friendly, concise, and instructive. Help the author understand why the suggestion was made. Provide inline links to relevant sources if applicable. 

Use RFC keywords to express importance and necessity:

- **Must:** A required change for successful functionality.
- **Should:** A recommendation that is likely applicable but may occasionally have valid reasons to ignore.
- **May:** An optional recommendation. 

Prefix any unimportant comments with `Nit:`  to indicate that the comment is a nitpick. Any review with only nitpick comments should be approved. 

