---
name: github:pr-comments
description: Fetch, reply to, and resolve review threads on a GitHub pull request. Use when checking what review feedback needs addressing, whether threads are resolved, replying to review comments, or clearing AI-reviewer threads after acting on them.
allowed-tools:
  ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)", "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
---

# PR Review Comments

Fetch unresolved review threads from a GitHub pull request, filtered for context efficiency. Avoids flooding the context with resolved threads. Outdated threads are included but marked.

## Usage

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts <pr-url> [--role author|reviewer] [--since last-review|<date>] [--bots]
```

## Arguments

- `<pr-url>`: GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- `--role`: `author` or `reviewer` (default: auto-detect based on authenticated user)
- `--since`: filter to threads with activity since `last-review` or an ISO date
- `--bots`: only review-bot threads (accounts the API types as `Bot`), plus any logins in `$CLAUDE_PLUGIN_DATA/reviewers.txt`

## Role

- **author** (default when authenticated user is the PR author): shows all unresolved threads, the feedback that needs addressing.
- **reviewer** (default when authenticated user is not the PR author): shows only unresolved threads started by the authenticated user, to check whether comments have been resolved.

## Since

- `last-review`: Scopes to threads with activity since the last relevant review.
  - As author: since the most recent review by a human other than you (bot reviews are excluded)
  - As reviewer: since your most recent submitted review
- ISO date: explicit cutoff (e.g., `2025-01-15`)

## Output

Compact markdown grouped by file with line numbers and full comment bodies, enough to act on the feedback directly without additional API calls. Each thread prints its node `id`, used to reply and resolve.

## Replying and Resolving

Reply to and resolve threads through the `addPullRequestReviewThreadReply` and `resolveReviewThread` mutations, addressing a thread by the `id` from the fetch output.

```bash
# Reply, or reply and resolve in one call
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --body "..."
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --resolve --body "..."

# Resolve alone (prefer reply --resolve so the resolve carries context)
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts resolve <thread-id>
```

Pass the reply text with `--body`, `--bodyFile <path>`, or stdin. Don't resolve without a reply: a silent resolve hides why the thread closed.
