# Auto-Merge

Enable auto-merge once the PR/MR exists, on a repo you own (the Remote URL names the owner) and not on a draft. Leave a third-party repo's merge to the maintainer. Auto-merge only sets a flag that branch protection still gates. Use `pull-request:babysit` to drive red CI or a pending review.

- **GitHub**: `gh pr merge --auto`. Add `--squash` or `--rebase` to match the repo's merge method when known (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`).
- **GitHub, stacked**: no auto-merge equivalent exists for a stacked PR. Say so and suggest `pull-request:babysit <url> --merge`.
- **GitLab**: load `gitlab:merge-request` and run its `merge.ts --auto-merge`, which handles merge trains and falls back to `glab mr merge`.

A repo with auto-merge disabled rejects `gh pr merge --auto`. Report that the PR needs a manual merge, leave the merge to the user, and continue.
