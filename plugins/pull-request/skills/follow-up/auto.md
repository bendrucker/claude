# Autonomous Round Mechanics

## A Round

1. Apply batched fixes, commit, and push once. The bot then has one new SHA to re-review.
2. Reply-and-resolve the noise threads (`github:pr-comments` or `gitlab:merge-request` do both in one call).
3. Escalate the unsure threads. Actionable pushes proceed.
4. Hand CI to `pull-request:babysit`, which stops at green. Its Monitor watcher re-invokes you on CI events, so wait for the harness wake rather than a `ScheduleWakeup`.
5. Get the bot onto the green SHA, then read the score.

## Waiting for the Re-Review

Where the repo re-reviews pushes automatically, wait for it with `ScheduleWakeup`, since no Monitor watcher tracks it. Set `prompt` to this same `/pull-request:follow-up` invocation so the wake re-enters the loop. Use ~270s for an idle wait before re-triggering, or 180-240s when a fast re-review is expected. Keep every tick under 300s, the cache-expiry boundary.

On wake, re-fetch bot threads and read the score on HEAD. Stop if the bar is clear or a guard stops the loop. Otherwise, when no re-review has posted, post one top-level `@<bot>` re-trigger ([reviewers.md](reviewers.md)) and re-arm.

On a repo that reviews only on request (Greptile with `triggerOnUpdates: false`), post the re-trigger right after the green push and arm the tick only to collect the result. `greptile config --json` reports the live setting.

## An Empty Thread List

When a bot review is expected ([reviewers.md](reviewers.md)) but no summary is posted on HEAD, the review is still running: wait and re-trigger as above, bounded by the idle timeout. When no review is expected, there is nothing to do, so stop.

## Composing With babysit

`babysit --reviews` hands off to this loop after its first green, and this loop calls babysit between rounds. Whichever was invoked first is the entry point. "Wait for a bot review before merging" is `babysit --reviews --merge`, or this loop then merge.
