# Merge Mode

Load this when babysit runs with `--merge`. Don't stop at green: drive the PR to **merged**. CI green is the entry condition. From here, submit to the repo's merge mechanism and recover from kickouts until it lands. GitHub merges run through `gh` directly. Delegate all GitLab merge behavior (trains, endpoint, squash) to `gitlab:merge-request`.

First confirm the PR can merge on its own. Don't bypass blocks you can't resolve: missing **human** approval (you can't self-approve; if a bot was the blocker and `--reviews` ran, it's already handled), branch protection, draft state, or requested changes. Report and `TaskStop`. Read state via `gh pr view --json mergeable,mergeStateStatus,reviewDecision,state` (GitLab: `gitlab:merge-request`).

On GitHub, check stack membership before submitting, because `gh pr merge` does not work on a stacked PR:

```
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stack{number size}}}}' -F owner=<owner> -F repo=<repo> -F number=<n>
```

`"stack": null` takes the unstacked path below. Anything else routes to [Stacked PRs](#stacked-prs).

Submit by the most automated path the repo allows (merge queue/train, else auto-merge, else direct, valid since CI is green):

- **GitHub, unstacked**: `gh pr merge <pr-url> --auto --squash` enables auto-merge or queues the PR. If `--auto` is rejected, merge directly: `gh pr merge <pr-url> --squash`. Prefer squash → merge → rebase per `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`.
- **GitHub, stacked**: see [Stacked PRs](#stacked-prs).
- **GitLab**: delegate to the `gitlab:merge-request` skill.

## Stacked PRs

Load `github:stack` for the full command surface. Submit with `gh stack merge <pr-number> --yes --squash`, which merges every PR at or below this one atomically and leaves the layers above open for GitHub to retarget and rebase. Match the method to the repo the same way as the unstacked path.

Run the pre-flight block check against every PR at or below this one. The merge is all-or-nothing. A lower layer that is red, draft, or short an approval sinks the whole call. Read the members from the stack `entries` and check each with `position` at or below yours:

```
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stackEntry{position stack{entries(first:50){nodes{position pullRequest{number state isDraft reviewDecision mergeStateStatus}}}}}}}}' -F owner=<owner> -F repo=<repo> -F number=<n>
```

A block on another layer is unrecoverable from here: babysit watches one PR and can't fix a sibling's CI. Report which layer blocks and `TaskStop`.

The watcher still follows this PR alone. `merged` means this PR landed and stays the success terminal. Under a merge queue the stack enters as a unit and lands as the queue processes it, possibly in separate groups. Treat lower layers merging first as progress and keep waiting for the watcher's own terminal. A warning that the queue ignored the method flag reports the queue picking its own method, and the submit stands.

## Re-arm

A push drops the PR from the merge mechanism (GitLab: off the train; GitHub: clears queued auto-merge) and fires **no monitor event**. So after **every** push in Merge Mode, re-submit by the same path as the initial submit above instead of waiting. Each re-arm counts toward the 3-attempt oscillation guard below.

A stacked PR re-arms on the next `status: success` instead. `gh stack merge` submits immediately and has no `--auto` to arm ahead of green. Run it straight after a push and it either fails the branch-protection check or lands unverified code. The push has already dropped the stack from any queue it was in and nothing is waiting on it. The delay costs only the CI wait that would have happened anyway. It still counts as an attempt.

Then watch the merge through the monitor rather than polling by hand: invoke the provider's monitor skill again on the PR and react to its events. The watcher enforces the interval and the wall clock, so this phase stays bounded like the CI wait (see [Bounds](SKILL.md#bounds)) and babysit owns no loop here. React to:

- `merged`: the PR landed. Report success and `TaskStop`.
- `conflicts`: route through the [conflicts](SKILL.md#conflicts) handler, then re-arm. Counts as a submit attempt.
- `status: failing`: route through the [status: failing](SKILL.md#status-failing) handler; the pushed fix produces a new SHA, then re-arm. Counts as a submit attempt.
- `pr-closed`: the PR closed without merging. Report and `TaskStop`.
- `max-time-reached`: report and `TaskStop`; do not re-arm.

Stop re-submitting after 3 attempts (re-submits included, an oscillation guard) or an unrecoverable block (missing human approval, non-trivial CI failure, non-lockfile conflict, permissions).
