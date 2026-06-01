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
  - Skill(gitlab:merge-request)
  - Skill(pull-request:babysit)
  - mcp__github
---

# PR Follow-Up

Follow up on review feedback for: $ARGUMENTS

Parse the URL and flags from `$ARGUMENTS`. GitHub URLs contain `github.com`; GitLab URLs contain the instance hostname. GitHub is primary: work through `gh`, `mcp__github`, and `github:*` skills directly. Delegate all GitLab behavior to `gitlab:merge-request` (no `glab` calls here).

- `--auto`: autonomously triage **bot** threads, looping until the reviewer is satisfied (see [The Autonomous Loop](#the-autonomous-loop)).
- `--include-human-nits`: under `--auto`, also act on **human** threads, but only trivial high-confidence changes (typos, renames, one-liners). Off by default.

## Default Workflow (Gated)

Without `--auto`, stay read-only: fetch, classify, draft, and **check with me before posting or resolving**.

Fetch all resolvable threads (resolved and unresolved) via `github:pr-comments` (`--role author`) or `gitlab:merge-request`, then classify each:

- **Unresolved / no reply**
- **Unresolved / replied**
- **Resolved / with reply**
- **Resolved / silent**: resolved with no author reply; flag these, they hide context

For unresolved threads, diff the comment's creation date against HEAD to see whether later commits already addressed the feedback. Draft replies per [replies.md](replies.md).

## The Autonomous Loop

With `--auto`, drive bot threads to closure without asking. Partition threads with each provider's `--bots` filter (`github:pr-comments`, `gitlab:merge-request`): fetch once filtered for the bot set, once unfiltered to see the human threads you're leaving alone. Add new reviewers per [reviewers.md](reviewers.md).

Triage each bot thread:

- **Actionable** → fix in the working tree, batching across threads
- **Noise / false positive** → reply with a one-line reason and resolve
- **Unsure** → collect to escalate; don't guess

Then run each round:

1. Apply batched fixes, commit, push **once** (one new SHA to re-review).
2. Reply-and-resolve the noise threads (`github:pr-comments` or `gitlab:merge-request` do both in one call).
3. Escalate the unsure threads and pause **that subset only**; actionable pushes proceed.
4. Hand CI back to `pull-request:babysit` (it owns CI, stops at green).
5. Re-fetch bot threads to poll for the re-review. If none lands within ~5 min of green, post one top-level `@<bot>` re-trigger and reset the timer.

Loop until: the reviewer's satisfaction signal hits on HEAD ([reviewers.md](reviewers.md)); no new bot threads for two rounds after a green push; max 4 rounds (oscillation guard); the idle timeout outlasts the re-trigger; or the PR closes/merges.

babysit and follow-up compose both directions: `babysit --reviews` hands off to this loop after its first green, and this loop calls babysit between rounds. The entry point is the outer one.

On stop, report fixes, replies/resolves, and escalations. If the reviewer is satisfied, suggest the next action (human review, merge train, auto-merge) but don't perform it unless asked. `pull-request:babysit --merge` drives to merged.

## Guardrails

The gated default requires checking before any post or resolve. `--auto` lifts this for **bot threads only**; human threads stay gated unless `--include-human-nits`. Always:

- Resolve only after replying; silent resolves hide context.
- Never name or thank the bot in a reply; write it as a note for any reader. The `@<bot>` re-trigger is the one exception.
- Match my writing style; you're replying as me.
