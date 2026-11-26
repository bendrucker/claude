# Merge Mode

Starting from green CI, submit the PR to the repo's merge mechanism and recover from kickouts until the watcher emits `merged`. GitHub merges run through `gh`. Delegate all GitLab merge behavior (trains, endpoint, squash) to `gitlab:merge-request`.

## Pre-flight

Read state with `gh pr view --json mergeable,mergeStateStatus,reviewDecision,state` (GitLab: `gitlab:merge-request`). Report and `TaskStop` on a block babysit cannot resolve: missing human approval, branch protection, draft state, or requested changes. A bot blocker is already handled when `--reviews` ran.

On GitHub, check stack membership, because `gh pr merge` fails on a stacked PR:

```
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stack{number size}}}}' -F owner=<owner> -F repo=<repo> -F number=<n>
```

`"stack": null` takes the unstacked path. Anything else takes [Stacked PRs](#stacked-prs).

## Submit

Use the most automated path the repo allows: merge queue or train, else auto-merge, else direct.

- GitHub, unstacked: `gh pr merge <pr-url> --auto --squash`. When `--auto` is rejected, `gh pr merge <pr-url> --squash`. Pick the method in the order squash, merge, rebase from `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`.
- GitLab: `gitlab:merge-request`.

## Stacked PRs

Load `github:stack` for its commands, the entries query, and what `position` and `mergeStateStatus` mean. Submit with `gh stack merge <pr-number> --yes --squash`, matching the method to the repo as above. It merges every PR at or below this one atomically and leaves the layers above open.

Run pre-flight against every PR at or below this one, since one blocked layer sinks the whole call. A block on another layer is outside babysit's reach: report which layer blocks and `TaskStop`.

The watcher follows this PR alone, and its `merged` stays the success terminal. Under a merge queue, lower layers may merge first in separate groups: keep waiting. A queue warning that it ignored the method flag is a successful submit.

## Re-arm

A push drops the PR from the merge mechanism, and the monitor emits nothing for it. After every push in Merge Mode, re-submit by the same path, without waiting for an event.

For a stacked PR, wait for the next `status: success` and re-submit there, because `gh stack merge` has no `--auto` and submits immediately.

Watch the merge by invoking the provider's monitor skill again on the PR, and handle its events per [SKILL.md](SKILL.md#event-handlers) and [`references/events.md`](references/events.md). Re-arm after any fix or conflict push.

Stop re-submitting and `TaskStop` after 3 submit attempts, counting every re-arm and stacked wait, or on an unrecoverable block: missing human approval, a non-trivial CI failure, a conflict beyond lockfiles and additive keys, or permissions.
