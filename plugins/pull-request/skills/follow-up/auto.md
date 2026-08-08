# Autonomous Round Mechanics

How a `--auto` round runs once triage is done. The triage partition and the acceptance bar live in [SKILL.md](SKILL.md#the-autonomous-loop). Per-reviewer scores, expectation signals, and re-trigger phrases live in [reviewers.md](reviewers.md).

## A Round

1. Apply batched fixes, commit, push **once** (one new SHA to re-review).
2. Reply-and-resolve the noise threads (`github:pr-comments` or `gitlab:merge-request` do both in one call).
3. Escalate the unsure threads and pause **that subset only**; actionable pushes proceed.
4. Hand CI back to `pull-request:babysit` (it owns CI, stops at green). babysit's Monitor watcher re-invokes you on CI events, so don't wrap that wait in `ScheduleWakeup`; the harness wakes you.
5. Get the bot onto the green SHA, then re-read the score.

## Waiting for the Re-Review

Where the repo re-reviews pushes automatically, wait for it. No Monitor watcher tracks this, so self-pace with `ScheduleWakeup`: arm a tick (`prompt` set to this same `/pull-request:follow-up` invocation so the wake re-enters the loop) at ~270s for an idle wait before re-triggering, or 180-240s when a fast re-review is expected. Never 300s (the cache-expiry boundary).

On wake, re-fetch bot threads and read the score on HEAD. Stop if the bar is clear or a guard fires. Otherwise, when no re-review landed, post one top-level `@<bot>` re-trigger ([reviewers.md](reviewers.md)) and re-arm the next tick.

On a repo that reviews only on request (Greptile with `triggerOnUpdates: false`, for one), that wait is dead time. No re-review is coming until you ask, so post the re-trigger right after the green push and arm the tick only to collect the result. `greptile config --json` reports the live setting.

## An Empty Thread List

When a bot review is **expected** ([reviewers.md](reviewers.md) defines the signals) but no summary has landed on HEAD, the review is still running: wait through the same wake and re-trigger for the first summary, bounded by the idle timeout. A thread list that is empty because no bot reviewer is expected is nothing to do, so stop.

## Composing with babysit

babysit and follow-up compose both directions: `babysit --reviews` hands off to this loop after its first green, and this loop calls babysit between rounds. The entry point is the outer one. "Wait for a bot review before merging" is exactly this pairing (`babysit --reviews --merge`, or this loop then merge).
