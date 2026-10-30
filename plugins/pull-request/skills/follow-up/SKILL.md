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

On GitHub, work through `gh`, `mcp__github`, and `github:*` skills. On GitLab, delegate everything to `gitlab:merge-request` instead of calling `glab`.

## Arguments

- `--auto`: triage bot threads autonomously until the [acceptance bar](#acceptance-bar) is met. Human threads still need my approval.
- `--include-human-nits`: under `--auto`, also act on human threads, limited to trivial high-confidence changes (typos, renames, one-liners).
- `--local [base]`: run the bot loop pre-push through the reviewer's CLI against the branch's unmerged commits ([Local Mode](#local-mode-pre-push)). The base overrides what the review runs against. The other arguments apply only to a PR.

With no flags, run the gated default.

## Default Workflow (Gated)

Make no changes, and check with me before posting or resolving anything.

Fetch all resolvable threads, resolved and unresolved, via `github:pr-comments --role author` or `gitlab:merge-request`. Classify each:

- Unresolved / no reply
- Unresolved / replied
- Resolved / with reply
- Resolved / silent: resolved without an author reply. Flag these, since they hide context.

For each unresolved thread, compare its creation date against later commits to see whether they addressed it. Draft replies per [replies.md](replies.md).

Done when every thread is classified, silent resolves are flagged, and each thread that needs a reply has a draft.

## The Autonomous Loop

With `--auto`, drive bot threads to closure without asking. Fetch twice with the provider's `--bots` filter: once for the bot threads, once unfiltered to see the human threads you leave alone. Add reviewers per [reviewers.md](reviewers.md).

Triage each bot thread:

- Actionable: fix in the working tree, batching across threads. Acknowledge a straightforward fix (test coverage, a rename, an obvious guard) with a thumbs up reaction (`github:pr-comments`, Reactions).
- Noise or false positive: reply with a one-line reason and resolve, or thumbs down a clearly wrong comment.
- Unsure: ask me about these and pause only those threads.

Each round pushes the batched fixes once, waits for passing CI, and gets the bot to review that SHA. [auto.md](auto.md) has the round mechanics, the wake cadence, and review-on-request repos.

### Acceptance Bar

The loop ends when the reviewer's score on the current HEAD is at its maximum (Greptile `5/5`, CodeRabbit `Actionable comments posted: 0`), or when every comment still standing carries a written reply giving the reason it was declined. Read the score off the summary comment on HEAD ([reviewers.md](reviewers.md)). A score from an earlier SHA is stale. An absent summary where a review is expected means the review is still running, so keep waiting.

Guards stop a loop that can't converge: no new bot threads for two rounds after a green push, four rounds total, an idle timeout that outlasts the re-trigger, or the PR closing or merging. A guard ends the run without clearing the bar, so report the score reached and each comment left standing without a reason.

On stop, report fixes, replies and resolves, and escalations. Once the bar is clear, suggest the next action (human review, merge train, auto-merge) and leave it to me. `pull-request:babysit --merge` drives to merged.

## Local Mode (Pre-Push)

With `--local`, run the same reviewer against the branch's unmerged commits before anything is pushed. Triage and the acceptance bar are the same, with findings from CLI output instead of PR threads and the score in its local form ([local.md](local.md)). A declined finding goes in the report with its reason.

Run this mode unprompted when you are about to push or open a PR in a repo with an available bot and the diff warrants a metered review ([local.md](local.md) sets that gate). Skip it when `/ship` or `pull-request:create` already ran it on this branch.

- Local detection: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-bot.ts`

Resolve that line to a provider per [local.md](local.md), which also covers the CLI mechanics and the hosted signals for repos with no config file. A provider reported as paused is out: report the pause and stop.

Then loop: run the review per [local.md](local.md), summarize findings by severity with a `file:line` each, triage with the `--auto` partition, commit the fixes, and re-run until the bar is clear or I stop. State your reasoning for each finding you disagree with. Finish by offering next steps (push, PR, `/ship`) for me to take.

Once a PR exists, triage the hosted bot's comments through the flow above.

## Guardrails

`--auto` lifts the posting gate for bot threads only. Human threads stay gated unless `--include-human-nits`. In every mode:

- Reply or react before resolving.
- Write bot replies as notes for any reader, per [replies.md](replies.md). The `@<bot>` re-trigger is the one place a bot is named.
- Reserve thumbs down for bot comments.
- Match my writing style, since you're replying as me.
