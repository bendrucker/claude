# Stacked MRs

In a stack, each MR targets the branch below it. GitLab auto-retargets a child only when the parent's merge deletes its source branch. It refuses to delete a branch an open MR targets, even with `remove_source_branch_after_merge` on. The child therefore keeps targeting a merged branch and its diff shows the parent's commits.

## Per-Layer Retarget

After each layer merges, fix the next open layer before merging it:

```bash
glab mr update <child-iid> --target-branch main   # also resets approvals, giving a fresh review against the real base
glab mr rebase <child-iid>
git fetch origin main <child-branch>
git merge-base --is-ancestor origin/main origin/<child-branch>
```

The layer is ready when `merge-base --is-ancestor` exits zero, or `merge.ts <child-branch> --status` reports `rebased_on_target: true`. Read rebase state only from these git checks. GitLab's `conflicts` and `detailed_merge_status` fields keep the pre-rebase value for minutes.

## Parent Branch Cleanup

Once the child targets `main`, delete the merged parent:

```bash
glab api projects/:id/repository/branches/<parent-branch> -X DELETE
```
