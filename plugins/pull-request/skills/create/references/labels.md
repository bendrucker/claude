# Labels

Pass `--label` on the create call. A review bot that gates on a label reads the labels present when the PR opens. A label added afterward arrives as a `labeled` event, which a repo with automatic re-review off may ignore.

An undefined label fails the create outright, discarding the body. Confirm each label first and pass only the ones that resolve:

```
gh label list --search <name> --json name --jq '.[].name'   # GitHub
glab label list                                             # GitLab
```

On no match, say which label doesn't exist, offer `gh label create <name>`, and open the PR without it. If the missing label gated a review, say the review waits until someone adds the label.
