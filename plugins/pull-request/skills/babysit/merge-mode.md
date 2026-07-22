# Merge Mode

Load this when babysit runs with `--merge`. Don't stop at green: drive the PR to **merged**. CI green is the entry condition. From here, submit to the repo's merge mechanism and recover from kickouts until it lands. GitHub merges run through `gh` directly. Delegate all GitLab merge behavior (trains, endpoint, squash) to `gitlab:merge-request`.

First confirm the PR can merge on its own. Don't bypass blocks you can't resolve: missing **human** approval (you can't self-approve; if a bot was the blocker and `--reviews` ran, it's already handled), branch protection, draft state, or requested changes. Report and `TaskStop`. Read state via `gh pr view --json mergeable,mergeStateStatus,reviewDecision,state` (GitLab: `gitlab:merge-request`).

Submit by the most automated path the repo allows (merge queue/train, else auto-merge, else direct, valid since CI is green):

- **GitHub**: `gh pr merge <pr-url> --auto --squash` enables auto-merge or queues the PR. If `--auto` is rejected, merge directly: `gh pr merge <pr-url> --squash`. Prefer squash → merge → rebase per `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`.
- **GitLab**: delegate to the `gitlab:merge-request` skill.

## Re-arm

A push drops the PR from the merge mechanism (GitLab: off the train; GitHub: clears queued auto-merge) and fires **no monitor event**. So after **every** push in Merge Mode, re-submit by the same path as the initial submit above instead of waiting. Each re-arm counts toward the 3-attempt oscillation guard below.

Then watch the merge through the monitor rather than polling by hand: invoke the provider's monitor skill again on the PR and react to its events. The watcher enforces the interval and the wall clock, so this phase stays bounded like the CI wait (see [Bounds](SKILL.md#bounds)) and babysit owns no loop here. React to:

- `merged`: the PR landed. Report success and `TaskStop`.
- `conflicts`: route through the [conflicts](SKILL.md#conflicts) handler, then re-arm. Counts as a submit attempt.
- `status: failing`: route through the [status: failing](SKILL.md#status-failing) handler; the pushed fix produces a new SHA, then re-arm. Counts as a submit attempt.
- `pr-closed`: the PR closed without merging. Report and `TaskStop`.
- `max-time-reached`: report and `TaskStop`; do not re-arm.

Stop re-submitting after 3 attempts (re-submits included, an oscillation guard) or an unrecoverable block (missing human approval, non-trivial CI failure, non-lockfile conflict, permissions).
