---
name: pull-request:follow-up
description: >
  Follow up as the author on review feedback on your PR/MR: triage and draft replies, catch
  silent resolves, and drive bot reviewers to a passing score. Triggers: "address reviewer
  feedback", "make the bot reviewer pass", "greptile/coderabbit review", "bot review before
  pushing".
argument-hint: "[pr-url] [--auto] [--include-human-nits] [--local [base]]"
allowed-tools:
  - Bash(git:*)
  - Bash(gh:*)
  - Bash(greptile:*)
  - Bash(coderabbit:*)
  - Bash(jq:*)
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*)"
  - Skill(github:pr-comments)
  - Skill(gitlab:merge-request)
  - Skill(pull-request:babysit)
  - mcp__github
---

# PR Follow-Up

Follow up on review feedback for: $ARGUMENTS

Parse the URL and flags from `$ARGUMENTS`. GitHub is primary: work through `gh`, `mcp__github`, and `github:*` skills directly. Delegate all GitLab behavior to `gitlab:merge-request` (no `glab` calls).

## Arguments

- `--auto`: autonomously triage **bot** threads, looping until the acceptance bar is met (see [The Autonomous Loop](#the-autonomous-loop)). Human threads stay gated.
- `--include-human-nits`: under `--auto`, also act on **human** threads, but only trivial high-confidence changes (typos, renames, one-liners). Off by default.
- `--local [base]`: run the bot loop pre-push through the reviewer's CLI instead of PR threads, against the branch's unmerged commits (see [Local Mode](#local-mode-pre-push)). The optional base overrides what the review runs against. No PR is involved, so `pr-url` and the other flags don't apply.

With no flags, run the gated default.

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

Each round: apply the batched fixes and push once, reply-and-resolve the noise, escalate the unsure threads and pause that subset only, then get CI green and the bot onto the green SHA. [auto.md](auto.md) has the round mechanics: the babysit handoff, the wake cadence while a re-review lands, and repos that review only on request.

### Acceptance Bar

The loop ends when the reviewer's own score on the current HEAD is at its maximum (Greptile `5/5`, CodeRabbit `Actionable comments posted: 0`), or when every comment still standing below that maximum carries a written reply giving the reason it was declined. Read the score off the summary comment on HEAD ([reviewers.md](reviewers.md)): a score from an earlier SHA is stale, and an absent summary where a review is expected means the review is still running, so keep waiting for it.

A score short of the maximum with a silently skipped comment behind it does not clear the bar. Fix the comment or write the reason.

Guards stop a loop that can't converge: no new bot threads for two rounds after a green push, four rounds total, an idle timeout that outlasts the re-trigger, or the PR closing or merging. A guard ends the run without clearing the bar, so report the score reached and each comment left standing without a reason.

On stop, report fixes, replies/resolves, and escalations. Once the bar is clear, suggest the next action (human review, merge train, auto-merge) but don't perform it unless asked. `pull-request:babysit --merge` drives to merged.

## Local Mode (Pre-Push)

With `--local`, run the same reviewer against the branch's unmerged commits before anything is pushed. Criteria and acceptance bar don't change with the channel: findings arrive as CLI output instead of PR threads, and the score in its local form ([local.md](local.md)) is still the exit. A declined finding goes in the report with its reason instead of a resolved thread.

Fire this mode unprompted when you are about to push or open a PR in a repo with an available bot and the diff warrants a metered review ([local.md](local.md) sets that gate). `/ship` runs this as a gated pass and `pull-request:create` runs it before pushing, so skip it when either already ran on this branch.

- Local detection: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-bot.ts`

The line above is the injected fast path (repo config, CLI presence, and any live cooldown, no turn spent). Resolve it to a provider per [local.md](local.md), which also covers the CLI mechanics and the hosted signals for repos with no config file. A provider reported as paused is out: report the pause and stop.

Then loop: run the review per [local.md](local.md), summarize findings by severity with a `file:line` reference each, triage with the same partition as `--auto`, commit the fixes, and re-run until the bar is clear or I stop. Surface a disagreement with your reasoning rather than skipping it silently. Finish by offering next steps (push, PR, `/ship`) without taking them.

Once a PR exists, triage the hosted bot's comments through the flow above.

## Guardrails

The gated default requires checking before any post or resolve. `--auto` lifts this for **bot threads only**; human threads stay gated unless `--include-human-nits`. Always:

- Resolve only after replying or reacting; silent resolves hide context.
- Never name or thank the bot in a reply; write it as a note for any reader ([replies.md](replies.md)). The `@<bot>` re-trigger is the one exception.
- Thumbs down is bot-only feedback. Never thumbs down a human thread, autonomously or otherwise.
- Match my writing style; you're replying as me.
