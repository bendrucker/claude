---
name: github:pr-comments
description: Fetch, reply to, and resolve review threads on a GitHub pull request. Use when checking what review feedback needs addressing, whether threads are resolved, replying to review comments, or clearing AI-reviewer threads after acting on them.
argument-hint: "<pr-url> [--role author|reviewer] [--bots] [--include-resolved]"
allowed-tools:
  ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)", "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"]
---

# PR Review Comments

## Fetching

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts <pr-url> [--role author|reviewer] [--since last-review|<date>] [--bots] [--include-resolved]
```

Output is markdown grouped by file, with each thread's node `id` for replying and resolving. Resolved threads are excluded by default. Outdated threads are included and marked.

- `--role`: `author` fetches all unresolved threads. `reviewer` fetches unresolved threads the authenticated user started. Defaults by whether the authenticated user is the PR author.
- `--since last-review`: threads with activity since the last relevant review. As author, that is the latest review by a human other than you. As reviewer, it is your latest submitted review. An ISO date (`2025-01-15`) sets an explicit cutoff.
- `--bots`: only review-bot threads, meaning accounts the API types as `Bot` plus the plugin's configured reviewers. Pass `--reviewers=${user_config.reviewers}` with it. Identify bots through this filter.
- `--include-resolved`: include resolved threads, tagged `(resolved)`, to find threads resolved without a reply.

## Replying and Resolving

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> [--resolve] --body "..."
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts react <thread-id> [--down] [--resolve]
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts resolve <thread-id>
```

`reply` also takes `--bodyFile <path>` or stdin. Upload a screenshot for a reply through the endpoint in `github:attach`, since `gh`'s `--attach` does not reach review threads.

Resolve each thread together with a reply or a reaction, through `reply --resolve` or `react --resolve`. The reply or reaction records why the thread closed. React with a thumbs up where an acknowledgment reply would add nothing (test coverage, a rename, an obvious guard). The reaction goes on the thread's first comment.

`--down` is feedback to a bot reviewer whose comment was wrong or unhelpful. Use it only on bot threads and only in an attended run.

On bot threads, push the fix and resolve, or react with a thumbs up. When a reply is needed, write it as a terse note for a future human reader ("Guarded with a null check").
