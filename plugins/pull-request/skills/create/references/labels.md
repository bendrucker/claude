# Labels

`--label` belongs on the create call. A hosted review bot decides whether to review when the PR opens, and on a repo that gates review on a label it reads the labels present at that moment. A label added a moment later arrives as a `labeled` event, which a repo running with automatic re-review off may ignore, leaving the requested review to never start.

An undefined label fails the create outright, though, which would throw away the body and every pre-PR pass behind it. So confirm each one first and pass only what resolved:

```
gh label list --search <name> --json name --jq '.[].name'   # GitHub
glab label list                                             # GitLab
```

No match means the label does not exist. Say which one, offer `gh label create <name>`, and open the PR without it. When the missing label was gating a review, say that the review waits on someone adding it.
