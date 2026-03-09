---
name: review:follow-up
description: >
  Follow up on a PR/MR you reviewed: check whether your comments were addressed, find silently
  resolved threads, and decide whether to re-review or approve.
  Use after leaving review feedback to see if the author acted on it.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - mcp__github
---

# Review Follow-Up

Follow up on my review of: $ARGUMENTS

## Workflow

Parse the URL from `$ARGUMENTS` to determine the platform. GitHub URLs contain `github.com`, GitLab URLs contain the GitLab instance hostname.

### Fetch Threads

Gather all resolvable discussion threads that I started (both resolved and unresolved).

**GitHub**: Use the `github:pr-comments` skill's script to fetch threads. Run with `--role reviewer` to get threads started by the authenticated user. For resolved threads, use the GraphQL API via `gh api graphql` to query `pullRequest.reviewThreads`, filtering to threads where the first comment author matches the viewer.

**GitLab**: Use the `gitlab:merge-request` skill's discussions script to fetch threads. Run with `--resolvable` to get all resolvable discussions, then filter to threads started by the authenticated user.

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

## Guardrails

- **Check with me** before submitting any review or comments.
- **Don't approve automatically**: present the evidence and let me decide.
- **Flag silently resolved threads** so I can decide whether to reopen or accept.
- **Distinguish code fixes from dismissals**: a resolved thread with matching code changes is different from one resolved with no changes.
