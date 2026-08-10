# Auto-Merge

Auto-merge is passive: it arms the platform and returns. Branch protection still gates the actual merge on checks and required approvals. It does not fix red CI or wait out a review, which is what `pull-request:babysit` is for.

On a repo you own it is the default. You are going to merge that PR yourself once the checks clear, and arming it up front saves the round trip. On a third-party repo it stays off, because the maintainer decides when the PR merges. A draft stays off too: GitHub refuses to arm auto-merge on a draft, so `--draft` and auto-merge never combine. `--no-auto` skips it anywhere.

- **GitHub**: `gh pr merge --auto`. Add `--squash` or `--rebase` to match the repo's merge method when known (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`).
- **GitHub, stacked**: auto-merge has no equivalent on a stacked PR. Say so and suggest `pull-request:babysit <url> --merge`, which drives the stack merge at green.
- **GitLab**: load `gitlab:merge-request` and run its `merge.ts --auto-merge`, which handles merge trains and falls back to `glab mr merge` as needed.

A repo with auto-merge turned off rejects `gh pr merge --auto`. Report that the PR waits for a manual merge and move on. Leave the landing to whoever decides it. Arming the platform was the whole request.
