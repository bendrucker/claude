# Labels

Pass `--label` on the create call. A review bot that gates on a label reads the labels present when the PR opens. A label added afterward arrives as a `labeled` event, which a repo with automatic re-review off may ignore.

An undefined label fails the create outright, discarding the body. Confirm each label first and pass only the ones that resolve:

```
gh label list --search <name> --json name --jq '.[].name'   # GitHub
glab label list                                             # GitLab
```

On no match, say which label doesn't exist, offer `gh label create <name>`, and open the PR without it. If the missing label gated a review, say the review waits until someone adds the label.

## Review Label

A repo whose hosted reviewer gates on a label reviews nothing until the label lands, so the label is the request. Apply it by default when the diff clears the gate in [When the Diff Warrants a Review](../../follow-up/local.md#when-the-diff-warrants-a-review), the same gate that decides the local pass. That section is authoritative, so the criteria stay in one place and can't drift.

A local pass already run on this branch suppresses the default: a diff earns one review through one channel, and that pass already spent the credit. A provider on a live cooldown suppresses it too, since a paused account reviews nothing on either channel. `--no-review` suppresses the default outright and leaves an explicit `--label` alone.

Find the gating label by name (`review` is the convention) with the label search above, `gh` or `glab` per host. The label is half the trigger: [On-Demand Review](../../follow-up/reviewers.md#on-demand-review) covers the rest, including `triggerOnUpdates`, which decides whether a later push re-reviews.

Metered allotments are finite and don't reset. Sizing the default to the gate holds the review rate near what the manual label already produced, and `local.md`'s recalibration trigger governs this default too: a limit hit there returns the label to explicit `--label`.
