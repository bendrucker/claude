---
name: github:pr-comments
description: Fetch, reply to, and resolve review threads on a GitHub pull request. Use when checking what review feedback needs addressing, whether threads are resolved, replying to review comments, or clearing AI-reviewer threads after acting on them.
argument-hint: "<pr-url> [--role author|reviewer] [--bots] [--include-resolved]"
allowed-tools:
  ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)", "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"]
---

# PR Review Comments

Fetch review threads from a GitHub pull request. Resolved threads are excluded by default. Outdated threads are included but marked.

## Usage

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts <pr-url> [--role author|reviewer] [--since last-review|<date>] [--bots] [--include-resolved]
```

- `--role`: `author` fetches all unresolved threads, the feedback that needs addressing. `reviewer` fetches only unresolved threads started by the authenticated user, to check whether comments have been resolved. Defaults by whether the authenticated user is the PR author.
- `--since last-review`: threads with activity since the last relevant review. As author: the most recent review by a human other than you (bot reviews excluded). As reviewer: your most recent submitted review. An ISO date (e.g. `2025-01-15`) sets an explicit cutoff.
- `--bots`: only review-bot threads: accounts the API types as `Bot` (Copilot, CodeRabbit, Greptile) plus logins in `$CLAUDE_PLUGIN_DATA/reviewers.txt`. Use this filter to detect bots rather than hardcoding logins.
- `--include-resolved`: include resolved threads, tagged `(resolved)`, for follow-up-style flows that must surface silently resolved threads.

Output is compact markdown grouped by file with line numbers and full comment bodies. Each thread prints its node `id`, used to reply and resolve.

## Replying and Resolving

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --body "..."
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --resolve --body "..."
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts resolve <thread-id>
```

Pass the reply text with `--body`, `--bodyFile <path>`, or stdin. Don't resolve without a reply: a silent resolve hides why the thread closed. Prefer `reply --resolve` so the resolve carries context. A reply that shows a screenshot uploads it first through the endpoint in `github:attach`. Review threads sit outside the reach of `gh`'s `--attach` flag.

## Reactions

React with a thumbs up where you would otherwise write a low-value acknowledgment reply (test coverage, a rename, an obvious guard). Stay silent where you would have stayed silent.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts react <thread-id> --resolve
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts react <thread-id> --down --resolve
```

The reaction lands on the thread's first comment. Thumbs down (`--down`) is feedback to a bot reviewer whose comment was wrong or unhelpful. Never thumbs down a human, and never in an autonomous run.

## Bot Reviewer Threads

On threads the `--bots` filter catches, don't converse with the bot. Push the fix and resolve the thread, or acknowledge with a thumbs up. If a reply is genuinely needed, state the resolution as a terse note for a future human reader ("Guarded with a null check"), not a message to the bot.
