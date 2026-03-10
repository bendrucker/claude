---
name: pull-request:follow-up
description: >
  Follow up on review feedback you received on a PR/MR: check resolution state, find silent
  resolves, draft replies. Use when checking what review comments need responses, investigating
  how threads were resolved, or drafting follow-up replies.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - mcp__github
---

# PR Follow-Up

Follow up on review feedback for: $ARGUMENTS

## Workflow

Parse the URL from `$ARGUMENTS` to determine the platform. GitHub URLs contain `github.com`, GitLab URLs contain the GitLab instance hostname.

### Fetch Threads

Gather all resolvable discussion threads (both resolved and unresolved).

**GitHub**: Use the `github:pr-comments` skill's script to fetch threads. Run with `--role author` to get all unresolved threads. For resolved threads, use the GraphQL API via `gh api graphql` to query `pullRequest.reviewThreads` with both `isResolved: true` and `isResolved: false`.

**GitLab**: Use the `gitlab:merge-request` skill's discussions script to fetch threads. Run with `--resolvable` to get all resolvable discussions, then partition by resolution state.

### Classify Threads

Sort each thread into one of four buckets:

- **Unresolved / no reply**: Reviewer left feedback, author hasn't responded
- **Unresolved / replied**: Author responded but thread remains open
- **Resolved / with reply**: Thread resolved after a reply (normal flow)
- **Resolved / silent**: Thread resolved without any author reply (needs attention)

### Present Summary

Show a table with counts per category. List each unresolved thread with the file, line, and a one-line summary of the feedback.

### Check Commit Coverage

For unresolved threads, check whether subsequent commits addressed the feedback by examining the diff between the review comment's creation date and HEAD. Indicate which threads appear addressed by code changes vs. which still need action.

### Draft Replies

Help draft follow-up replies for threads that need responses. See [replies.md](replies.md) for tone guidelines.

## Guardrails

- **Check with me** before posting any comments or resolving threads.
- **Don't resolve threads** without posting a reply first: silent resolution hides context.
- **Flag silently resolved threads** so I can decide whether to reopen or add a belated reply.
- **Match my writing style**: you're replying as me, not a generic assistant.
