# Auto-Merge

Enabling auto-merge only sets a flag. Branch protection still gates the merge on checks and approvals. Auto-merge can't fix red CI or wait for a review to finish. Use `pull-request:babysit` for that.

Enable it by default on a repo you own. Leave it off on a third-party repo (the maintainer decides) and on a draft (GitHub refuses it there). `--no-auto` disables it everywhere.

- **GitHub**: `gh pr merge --auto`. Add `--squash` or `--rebase` to match the repo's merge method when known (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`).
- **GitHub, stacked**: no auto-merge equivalent exists for a stacked PR. Say so and suggest `pull-request:babysit <url> --merge`.
- **GitLab**: load `gitlab:merge-request` and run its `merge.ts --auto-merge`, which handles merge trains and falls back to `glab mr merge`.

A repo with auto-merge disabled rejects `gh pr merge --auto`. Report that the PR needs a manual merge and continue. Don't merge it yourself.
