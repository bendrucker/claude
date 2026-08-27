# Stacked MRs

An MR stack is a chain where each MR targets the branch below it. Merging the bottom layer does not fix the layer above it. GitLab's auto-retarget only fires when the merge deletes the merged MR's source branch, and a stack's parent branch survives its own merge because the child MR still references it. The child then keeps targeting a branch that is already in `main`, its diff shows commits that merged with the parent, and the parent branch lingers.

Enabling `remove_source_branch_after_merge` on the project does not help. GitLab refuses to delete a branch another open MR targets. The setting is a no-op for exactly the case that needs it.

## Per-Layer Retarget

After each layer merges, run this against the next open layer before merging that one.

Retarget the child at `main`. This also resets approvals, which a serial merge wants: the layer gets a fresh review against its real base.

```bash
glab mr update <child-iid> --target-branch main
```

Rebase, dropping the parent's commits from the diff.

```bash
glab mr rebase <child-iid>
```

Verify against git.

```bash
git fetch origin main <child-branch>
git merge-base --is-ancestor origin/main origin/<child-branch>
```

A zero exit means the rebase landed. Do not check the MR's `conflicts` or `detailed_merge_status` field instead. GitLab recomputes those asynchronously and serves the pre-rebase value for minutes, long enough that a polling loop reports a conflict that no longer exists.

`merge.ts --status` reads the MR without mutating it and reports the same ancestry check as `rebased_on_target`, alongside target branch, pipeline, and merge status:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts <child-branch> --status
```

## Parent Branch Cleanup

Once the child targets `main`, nothing references the merged parent branch:

```bash
glab api projects/:id/repository/branches/<parent-branch> -X DELETE
```
