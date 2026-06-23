---
name: github:pr-comments
description: Fetch, reply to, and resolve review threads on a GitHub pull request. Use when checking what review feedback needs addressing, whether threads are resolved, replying to review comments, or clearing AI-reviewer threads after acting on them.
argument-hint: "<pr-url> [--role author|reviewer] [--bots]"
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

Fetch unresolved review threads from a GitHub pull request, filtered for context efficiency: resolved threads are excluded, outdated threads included but marked.

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

- **author** (default when authenticated user is the PR author): all unresolved threads, the feedback that needs addressing.
- **reviewer** (default when authenticated user is not the PR author): only unresolved threads started by the authenticated user, to check whether comments have been resolved.

## Since

- `last-review`: threads with activity since the last relevant review.
  - As author: since the most recent review by a human other than you (bot reviews excluded)
  - As reviewer: since your most recent submitted review
- ISO date: explicit cutoff (e.g., `2025-01-15`)

## Output

Compact markdown grouped by file with line numbers and full comment bodies, enough to act on the feedback directly without additional API calls. Each thread prints its node `id`, used to reply and resolve.

## Replying and Resolving

Reply to and resolve threads via the `addPullRequestReviewThreadReply` and `resolveReviewThread` mutations, addressing a thread by the `id` from the fetch output.

```bash
# Reply, or reply and resolve in one call
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --body "..."
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --resolve --body "..."

# Resolve alone (prefer reply --resolve so the resolve carries context)
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts resolve <thread-id>
```

Pass the reply text with `--body`, `--bodyFile <path>`, or stdin. Don't resolve without a reply: a silent resolve hides why the thread closed.

## Reactions

A reply is not always warranted. When the fix is straightforward and a reply would only acknowledge it (test coverage, a rename, an obvious guard), react with a thumbs up instead of writing a reply. A fleshed-out reply with code references to a bot is mechanical noise. The goal is fewer comments, not a new acknowledgement on every thread, so prefer a reaction only where you would otherwise have written a low-value reply, and stay silent where you would have stayed silent.

```bash
# Thumbs up, optionally resolving in the same call
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts react <thread-id> --resolve
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts react <thread-id> --down --resolve
```

The reaction lands on the thread's first comment. Thumbs down (`--down`) is feedback to a bot reviewer whose comment was wrong or unhelpful. Never thumbs down a human, and never in an autonomous run.

#### Bot Reviewer Threads

A bot reviewer is any account the `--bots` filter catches: accounts the API types as `Bot` (Copilot, CodeRabbit, Greptile) plus logins in `$CLAUDE_PLUGIN_DATA/reviewers.txt`. Use that filter to detect them rather than hardcoding logins.

Do not write human-voiced replies to these threads. No thanks, no "addressed in the latest revision", no conversation with the bot. Push the fix and resolve the thread, or just resolve it. For a straightforward change, a thumbs up reaction (see [Reactions](#reactions)) acknowledges the bot without a reply.

If a reply is genuinely needed, state the resolution as a terse note for a human reader ("Guarded with a null check"), not a message to the bot.
