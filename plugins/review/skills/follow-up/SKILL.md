---
name: review:follow-up
description: >
  Follow up on a PR/MR you reviewed: check whether your comments were addressed, find silently
  resolved threads, and decide whether to re-review or approve.
  Use after leaving review feedback to see if the author acted on it.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Skill(gitlab:*)
  - Skill(github:*)
---

# Review Follow-Up

Follow up on my review of: $ARGUMENTS

## Workflow

### Detect Platform

Parse the URL from `$ARGUMENTS` to determine the platform. GitHub URLs contain `github.com`, GitLab URLs contain the GitLab instance hostname.

#### GitLab

Load the `gitlab:api` and `gitlab:merge-request` skills for API patterns and MR tooling.

### Fetch Threads

Gather all resolvable discussion threads that I started (both resolved and unresolved).

#### GitHub

Use the `github:pr-comments` skill's script to fetch threads. Run with `--role reviewer` to get threads started by the authenticated user. For resolved threads, use the GraphQL API via `gh api graphql` to query `pullRequest.reviewThreads`, filtering to threads where the first comment author matches the viewer.

#### GitLab

Get the authenticated username, then use the `gitlab:merge-request` skill's `discussions.ts` script to fetch threads:

```bash
glab api user --jq .username 2>/dev/null
bun <gitlab:merge-request skill>/scripts/discussions.ts list <iid> --resolvable --author <username>
```

Include both resolved and unresolved threads (do not pass `--unresolved`) for classification.

When making direct `glab api` calls, append `2>/dev/null` to prevent config warnings from polluting JSON output.

### Classify Threads

Sort each thread into one of four buckets:

- **Unresolved / no author reply**: Author hasn't responded to my feedback
- **Unresolved / author replied**: Author responded, I need to evaluate their reply
- **Resolved / with reply**: Author replied and resolved (verify the reply is satisfactory)
- **Resolved / silent**: Author resolved without replying (was my feedback addressed or dismissed?)

### Present Summary

Show a table with counts per category. List each thread with the file, line, one-line summary of my original feedback, and whether the author replied.

### Check Commit Coverage

For each thread, examine commits pushed after my review submission. Indicate which threads appear addressed by code changes vs. which have no corresponding changes.

### Re-Review Decision

Help decide next action based on thread states:

- All threads addressed with replies and code changes: suggest approving
- Some threads have author replies but no code changes: present replies for evaluation
- Silent resolves found: flag each so I can decide whether to accept or reopen
- Unresolved threads with no reply: note these as still pending author action

### Execute Actions

After I decide on next steps, use platform-appropriate commands:

#### GitHub

- Approve: `gh pr review --approve`
- Comment: `gh pr comment`
- Resolve thread: `gh api graphql` with `resolveReviewThread` mutation

#### GitLab

- Approve: `glab api projects/:id/merge_requests/<iid>/approve -X POST 2>/dev/null`
- Resolve thread: `glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=true 2>/dev/null`
- Unresolve: same endpoint with `-f resolved=false`
- Comment: use `gitlab:merge-request` skill's `discussions.ts create` command

## Guardrails

- **Check with me** before submitting any review or comments.
- **Don't approve automatically**: present the evidence and let me decide.
- **Flag silently resolved threads** so I can decide whether to reopen or accept.
- **Distinguish code fixes from dismissals**: a resolved thread with matching code changes is different from one resolved with no changes.
