# Native Tracking

Every worktree reads the same stacks, because tracking is stored in the repository's common git dir. `rebase`, `sync`, and `modify` run each change in the worktree where that branch is checked out, and refuse to start while any affected checkout has uncommitted files or an unfinished git operation. `--continue` and `--abort` work from any worktree.

## Building

`init` adopts branches that exist and creates the ones that don't, bottom to top. It can adopt a branch checked out in another worktree.

```bash
gh stack init auth-layer api-routes ui-components  # adopt or create a whole stack
gh stack init --base develop my-feature            # non-default trunk
gh stack add -Am "Add rate limiting" rate-limits   # new layer on top, committing staged work
```

## Publishing

`gh stack submit` pushes every branch, opens the missing PRs, fixes the bases, and creates or updates the stack object. Interactively it opens a single-screen editor to write each new PR's title, description, and draft state before submitting them together. Use it whenever the bodies matter.

Non-interactively, and with `--auto`, it skips the editor, auto-generates titles, and creates new PRs as **drafts**. Pass `--open` to get PRs that are ready for review.

## Maintaining

`gh stack sync` fetches, reconciles against the stack on GitHub, fast-forwards the trunk, cascade-rebases each branch onto its parent, pushes with `--force-with-lease`, and links the open PRs into a stack once two exist. It never opens PRs. `--prune` deletes local branches for merged PRs, which is the cleanup after a stack merges.

When GitHub retargets a stack because its base branch was deleted, `sync` and `rebase` rebase onto the new base and ask before dropping commits from an old base that never merged. `--accept-base-change` skips the question.

The narrower commands:

- `gh stack rebase`: the cascading rebase alone (`--downstack`, `--upstack`, `--no-trunk`, and `--continue` / `--abort` around conflicts).
- `gh stack push`: push without rebasing.
- `gh stack modify`: restructure interactively (drop, fold, insert, reorder, rename). Run `submit` afterward, since it changes local branches only.

`push` and `submit` update every branch atomically. `--no-atomic` allows partial updates.

Move around with `gh stack checkout` (bare, for a picker over local and remote stacks), plus `up`, `down`, `top`, `bottom`, `trunk`, and `switch`.

## Switching Layouts

`gh stack checkout <stack-number>` adopts a stack that exists only on GitHub: it queries the API, fetches the branches, and sets up local tracking. Use it to move a stack published by `link` to native tracking.

`gh stack unstack --local` drops local tracking and leaves the stack on GitHub. Without `--local`, `unstack` also unstacks on GitHub, and takes a stack number to do that from anywhere. GitHub keeps PRs stacked when they are queued or have auto-merge enabled.
