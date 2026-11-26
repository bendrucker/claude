# Labels

Pass `--label` on the create call, since a label-gated review bot reads the labels present when the PR opens and may ignore one added afterward.

An undefined label fails the create outright, discarding the body. Confirm each label first and pass only the ones that resolve:

```
gh label list --search <name> --json name --jq '.[].name'   # GitHub
glab label list                                             # GitLab
```

On no match, say which label doesn't exist, offer `gh label create <name>`, and open the PR without it. If the missing label gated a review, say the review waits until someone adds the label.

## Review Label

A repo whose hosted reviewer gates on a label reviews nothing until the label lands, so the label is the request. Apply it by default when the diff clears the gate in [When the Diff Warrants a Review](../../follow-up/local.md#when-the-diff-warrants-a-review), the same gate that decides the local pass.

Skip the default when a local pass already ran on this branch (a diff gets one review through one channel), when the provider is on a live cooldown, or under `--no-review`. An explicit `--label` still applies.

Find the gating label by name (`review` is the convention) with the label search above, `gh` or `glab` per host. The label is half the trigger: [On-Demand Review](../../follow-up/reviewers.md#on-demand-review) covers the rest, including `triggerOnUpdates`, which decides whether a later push re-reviews.

`local.md`'s recalibration trigger governs this default: a limit hit there returns the label to explicit `--label`.
