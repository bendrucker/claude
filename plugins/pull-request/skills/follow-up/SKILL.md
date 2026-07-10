---
name: pull-request:follow-up
description: >
  Follow up on review feedback you received on a PR/MR: check what review comments need
  responses, investigate how threads were resolved (including silent resolves), and draft
  replies. With --auto, autonomously triage AI-reviewer (bot) threads and loop until the
  reviewer is satisfied, clearing a bot review hands-off.
argument-hint: "[pr-url] [--auto] [--include-human-nits]"
allowed-tools:
  - Bash(git:*)
  - Bash(gh:*)
  - Skill(github:pr-comments)
  - Skill(gitlab:merge-request)
  - Skill(pull-request:babysit)
  - mcp__github
---

# PR Follow-Up

Follow up on review feedback for: $ARGUMENTS

Parse the URL and flags from `$ARGUMENTS`. GitHub URLs contain `github.com`; GitLab URLs contain the instance hostname. GitHub is primary: work through `gh`, `mcp__github`, and `github:*` skills directly. Delegate all GitLab behavior to `gitlab:merge-request` (no `glab` calls).

- `--auto`: autonomously triage **bot** threads, looping until the reviewer is satisfied (see [The Autonomous Loop](#the-autonomous-loop)).
- `--include-human-nits`: under `--auto`, also act on **human** threads, but only trivial high-confidence changes (typos, renames, one-liners). Off by default.

## Default Workflow (Gated)

Without `--auto`, stay read-only: fetch, classify, draft, **check with me before posting or resolving**.

Fetch all resolvable threads (resolved and unresolved) via `github:pr-comments` (`--role author`) or `gitlab:merge-request`, then classify:

- **Unresolved / no reply**
- **Unresolved / replied**
- **Resolved / with reply**
- **Resolved / silent**: resolved with no author reply; flag these, they hide context

For unresolved threads, diff the comment's creation date against HEAD to see whether later commits addressed the feedback. Draft replies per [replies.md](replies.md).

## The Autonomous Loop

With `--auto`, drive bot threads to closure without asking. Partition threads with each provider's `--bots` filter (`github:pr-comments`, `gitlab:merge-request`): fetch once filtered for the bot set, once unfiltered to see the human threads you're leaving alone. Add reviewers per [reviewers.md](reviewers.md).

Triage each bot thread:

- **Actionable** → fix in the working tree, batching across threads. For a straightforward fix (test coverage, a rename, an obvious guard), acknowledge with a thumbs up reaction rather than a fleshed-out reply (see `github:pr-comments`, Reactions)
- **Noise / false positive** → reply with a one-line reason and resolve, or thumbs down a clearly wrong bot comment
- **Unsure** → collect to escalate; don't guess

Then run each round:

1. Apply batched fixes, commit, push **once** (one new SHA to re-review).
2. Reply-and-resolve the noise threads (`github:pr-comments` or `gitlab:merge-request` do both in one call).
3. Escalate the unsure threads and pause **that subset only**; actionable pushes proceed.
4. Hand CI back to `pull-request:babysit` (it owns CI, stops at green). babysit's Monitor watcher re-invokes you on CI events, so don't wrap that wait in `ScheduleWakeup`; the harness wakes you.
5. Wait for the bot to re-review the green SHA. No Monitor watcher tracks this, so self-pace with `ScheduleWakeup`: arm a tick (`prompt` set to this same `/pull-request:follow-up` invocation so the wake re-enters the loop) at ~270s for an idle wait before re-triggering, or 180-240s when a fast re-review is expected. Never 300s (the cache-expiry boundary). On wake, re-fetch bot threads and evaluate the loop-exit conditions below: if the reviewer is satisfied or another exit fires, stop; otherwise, if no re-review landed, post one top-level `@<bot>` re-trigger, then re-arm the next tick.

Loop until: the reviewer's satisfaction signal hits on HEAD ([reviewers.md](reviewers.md)); no new bot threads for two rounds after a green push; max 4 rounds (oscillation guard); the idle timeout outlasts the re-trigger; or the PR closes/merges.

When a bot review is **expected** ([reviewers.md](reviewers.md) defines the signals) but no summary has landed on HEAD, an empty thread list means the review is still pending. The two-round satisfied exit above doesn't apply yet: wait through the same wake and re-trigger for the first summary. The idle-timeout backstop still bounds that wait, so a review that never runs times out instead of looping past the round cap. With no bot reviewer expected, an empty result is nothing to do: stop.

babysit and follow-up compose both directions: `babysit --reviews` hands off to this loop after its first green, and this loop calls babysit between rounds. The entry point is the outer one. "Wait for a bot review before merging" is exactly this pairing (`babysit --reviews --merge`, or this loop then merge), keyed on each reviewer's signal ([reviewers.md](reviewers.md)).

On stop, report fixes, replies/resolves, and escalations. If the reviewer is satisfied, suggest the next action (human review, merge train, auto-merge) but don't perform it unless asked. `pull-request:babysit --merge` drives to merged.

## Guardrails

The gated default requires checking before any post or resolve. `--auto` lifts this for **bot threads only**; human threads stay gated unless `--include-human-nits`. Always:

- Resolve only after replying or reacting; silent resolves hide context.
- Never name or thank the bot in a reply; write it as a note for any reader. The `@<bot>` re-trigger is the one exception. A thumbs up is the lighter-weight acknowledgement, preferred over a reply for straightforward changes.
- Thumbs down is bot-only feedback. Never thumbs down a human thread, autonomously or otherwise.
- Match my writing style; you're replying as me.
