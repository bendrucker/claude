---
name: pull-request:follow-up
description: >
  Follow up on review feedback you received on a PR/MR: check resolution state, find silent
  resolves, draft replies. With --auto, autonomously triage AI-reviewer (bot) threads and loop
  until the reviewer is satisfied. Use when checking what review comments need responses,
  investigating how threads were resolved, drafting replies, or clearing a bot review hands-off.
allowed-tools:
  - Bash(git:*)
  - Bash(gh:*)
  - Skill(github:pr-comments)
  - Skill(github:review-threads)
  - Skill(gitlab:merge-request)
  - Skill(pull-request:babysit)
  - mcp__github
---

# PR Follow-Up

Follow up on review feedback for: $ARGUMENTS

Parse `$ARGUMENTS` for the PR/MR URL and flags. GitHub URLs contain `github.com`; GitLab URLs contain the GitLab instance hostname.

- `--auto`: autonomously triage **bot-authored** threads and loop until the reviewer is satisfied (see [The Autonomous Loop](#the-autonomous-loop)). Without it, the skill is read-only and gated: fetch, classify, draft, and check with me before posting or resolving.
- `--include-human-nits`: in `--auto`, also act on **human** threads, but only high-confidence trivial changes (typos, renames, obvious one-liners). Off by default: human threads are listed and left alone.

## Default Workflow (Gated)

### Fetch Threads

Gather all resolvable discussion threads (both resolved and unresolved).

**GitHub**: Use the `github:pr-comments` skill to fetch unresolved threads (`--role author`). For resolved threads, read them through `gh` or `mcp__github`.

**GitLab**: Use the `gitlab:merge-request` skill to fetch resolvable discussions, then partition by resolution state.

GitHub is the primary platform, so this skill works with `gh`, `mcp__github`, and the `github:*` skills directly. All GitLab behavior is delegated to the `gitlab:merge-request` skill. No `glab` calls live here.

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

## The Autonomous Loop

With `--auto`, drive AI-reviewer threads to closure without asking, looping until the reviewer signals it is satisfied. See [reviewers.md](reviewers.md) for per-reviewer satisfaction signals and the re-trigger note.

### Partition Bot vs Human

Fetch unresolved threads and split them by author. Each provider plugin owns a `--bots-only` filter; this skill just asks for it.

- **GitHub**: use the `github:pr-comments` skill with `--bots-only`. It returns bot threads with their thread `id` and a `(bot)` marker. Fetch once without `--bots-only` to see the human threads you are leaving alone.
- **GitLab**: use the `gitlab:merge-request` skill to list unresolved bot discussions (its `--bots-only` filter), and again without the filter for the human set.

Each provider plugin classifies bots with a hardcoded allowlist of reviewer logins (plus GitHub's `__typename == "Bot"`). To teach the loop a new reviewer, add its login to that allowlist (see [reviewers.md](reviewers.md)).

### Triage Each Bot Thread

Apply this rubric to every bot thread:

- **Obviously actionable** → fix it in the working tree. Batch fixes across threads.
- **Obviously noise / false positive** → reply with a one-line reason and resolve. Never resolve silently.
- **Unsure** → collect to escalate. Do not guess.

### One Round

1. Apply all batched fixes. Commit. **Push once** (a single new SHA for the bot to re-review).
2. Post replies and resolve the noise threads. Every resolve carries a reply (see [replies.md](replies.md)).
   - **GitHub**: use the `github:review-threads` skill to reply and resolve (it does both in one call).
   - **GitLab**: use the `gitlab:merge-request` skill to reply and resolve (it does both in one call).
3. Escalate the unsure threads to me and pause **that subset only**. Actionable pushes still proceed.
4. Drive CI back to green by invoking `pull-request:babysit` (babysit owns CI and stops at green).
5. Poll for the re-review by re-fetching bot threads. If no new bot review lands within ~5 minutes after green, post one top-level `@<bot>` mention to re-trigger it and reset the timer (GitHub via `gh` or `mcp__github`, GitLab via the `gitlab:merge-request` skill). This @-mention is the **only** place a bot is named.
6. Repeat until a stop condition.

### Stop Conditions

Stop the loop on any of:

- **Reviewer satisfied**: the per-reviewer "done" signal in [reviewers.md](reviewers.md) (e.g. CodeRabbit "Actionable comments posted: 0", Greptile top score, Copilot "no further comments").
- **No new bot threads for two consecutive rounds** after a green push.
- **Max rounds** (default 4): guards a fix-then-new-nit oscillation.
- **Idle timeout exhausted** after the @-mention retry produced no new review.
- **PR closed or merged.**

When the loop stops, report what was fixed, what was replied/resolved, and any escalated threads. If the reviewer is satisfied, suggest the next action (request a human review, add to the merge train, enable auto-merge) but do not perform it unless I ask. `pull-request:babysit --merge` drives a PR to merged once you are ready.

## Composition With babysit

- **babysit** = CI green. **follow-up `--auto`** = review triage loop that *calls* babysit for each post-push CI wait.
- The entry point decides who is outer: babysit can hand off to `follow-up --auto` after its first green (`babysit --reviews`); `follow-up --auto` calls babysit between rounds.

## Guardrails

These apply to the gated default. The `--auto` exceptions below are scoped to **bot threads only**.

- **Check with me** before posting any comments or resolving threads. (`--auto` lifts this for bot threads; human threads stay gated unless `--include-human-nits`, and even then only for trivial high-confidence changes.)
- **Don't resolve threads** without posting a reply first: silent resolution hides context. (Always, including `--auto`.)
- **Never name the bot in replies**: write each reply as a note for any reader, no "thanks". The lone exception is the `@<bot>` re-trigger, which is a top-level comment, not a thread reply.
- **Flag silently resolved threads** so I can decide whether to reopen or add a belated reply.
- **Match my writing style**: you're replying as me, not a generic assistant.
