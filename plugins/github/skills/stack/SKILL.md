---
name: github:stack
description: Publish and merge GitHub native stacked pull requests with the `gh stack` extension. Use when a branch is stacked on another branch rather than the default branch, when linking a chain of branches into a stack on GitHub, or when merging a PR that belongs to a stack. Load before running any `gh stack` command.
allowed-tools:
  - Bash(gh stack:*)
  - Bash(gh pr:*)
  - Bash(gh api:*)
---

# Stacked Pull Requests

`gh stack` (the `github/gh-stack` extension) drives GitHub's native stacked PRs. The stack object on GitHub is the same either way, and so is the merge. What differs is where the branches live locally, which decides how the stack gets built and published.

## Layouts

**Native tracking** keeps every layer checked out in one working tree. `gh stack` owns the branches, the rebases, and the publish. This is what the extension is built for, and it gets the interactive PR editor, cascading rebase, and one-command sync.

**External tracking** keeps each layer somewhere else, typically its own worktree. Another tool owns the rebases and `gh stack link` publishes the result. `link` is documented for exactly this and writes no local state.

Pick per stack. The choice can differ across stacks in one repository. Native tracking fits a stack you are actively reshaping, where reordering and folding layers matters more than working two layers at once. External tracking fits a stack whose layers are worked on in parallel or over a long stretch, where each layer wants its own checkout, editor, and running services.

Read the current state with `gh stack view --short` (add `--json` to parse it). It answers from local tracking. Output means native tracking, and an error means the stack is not tracked here. That is a statement about this clone, not about GitHub: a stack published by `link` is real on GitHub and still absent from `view`.

Don't mix them for one stack. The local-tracking commands silently under-perform against branches they can't check out. `gh stack rebase` prints `✓ Rebased <branch>` and changes nothing when that branch is checked out in a different worktree ([gh-stack#35](https://github.com/github/gh-stack/issues/35)).

Exit code 9 means the repository doesn't have stacked PRs enabled. Code 6 means a branch belongs to more than one stack, or more than one remote is configured with no `remote.pushDefault` set. `link`, `submit`, `push`, and `sync` take `--remote` for that second case.

Stack numbers and PR numbers come from one sequence per repository and never overlap. A bare number is unambiguous wherever a command takes either.

## Detection

Stack membership lives on the API. This query answers with nothing checked out and under either layout, which makes it the right check for anything holding a PR number rather than a branch.

```bash
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stack{number size}}}}' \
  -F owner=<owner> -F repo=<repo> -F number=<n>
```

`"stack": null` means the PR isn't stacked. Otherwise `number` is the stack number and `size` its PR count. `gh pr view` has no stack field. This query is the only PR-level answer.

To read the other layers, ask for the entries. `position` counts up from the base, so position 1 is the bottom and the layers below yours are the ones with a lower position.

```bash
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stackEntry{position stack{entries(first:50){nodes{position pullRequest{number state isDraft reviewDecision mergeStateStatus}}}}}}}}' \
  -F owner=<owner> -F repo=<repo> -F number=<n>
```

There is no CI field here. `mergeStateStatus` is the proxy. `CLEAN` is mergeable with checks passing. `BLOCKED` is blocked by a rule or a missing review, `UNSTABLE` is a non-passing commit status, `DIRTY` is a conflict, and `BEHIND` is a stale head ref.

## Native Tracking

Build the stack with `init` and `add`. `init` adopts branches that exist and creates the ones that don't, bottom to top.

```bash
gh stack init auth-layer api-routes ui-components  # adopt or create a whole stack
gh stack init --base develop my-feature            # non-default trunk
gh stack add -Am "Add rate limiting" rate-limits   # new layer on top, committing staged work
```

`gh stack submit` pushes every branch, opens the missing PRs, fixes the bases, and creates or updates the stack object. Interactively it opens a single-screen editor to write each new PR's title, description, and draft state before submitting them together. Use it whenever the bodies matter, which is most of the time.

Non-interactively, and with `--auto`, it skips the editor and auto-generates titles. It also creates new PRs as **drafts**. Pass `--open` to get PRs that are ready for review.

`gh stack sync` is the maintenance command: fetch, reconcile against the stack on GitHub, fast-forward the trunk, cascade-rebase each branch onto its parent, push atomically with `--force-with-lease`, and link the open PRs into a stack once two exist. It never opens PRs. `--prune` deletes local branches for merged PRs, which is the cleanup after a stack lands.

Use the narrower commands when sync is too much: `gh stack rebase` for the cascading rebase alone (`--downstack`, `--upstack`, `--no-trunk`, and `--continue` / `--abort` around conflicts), and `gh stack push` to push without rebasing. `push` is per-branch and not atomic. A rejected branch leaves the ones before it already updated.

`gh stack modify` restructures the stack interactively: drop, fold, insert, reorder, rename. Run `submit` afterward, since it changes local branches and leaves GitHub behind.

Move around with `gh stack checkout` (bare, for a picker over local and remote stacks), plus `up`, `down`, `top`, `bottom`, `trunk`, and `switch`.

## External Tracking

Let the other tool rebase and push the whole stack first. `link` pushes without force. It rejects a branch whose remote copy has diverged, which is every branch immediately after a rebase.

`gh stack link` takes branches, PR numbers, or PR URLs bottom to top. It pushes each branch, opens a PR for any branch missing one, corrects the base of any PR whose base breaks the chain, and creates or updates the stack object.

```bash
gh stack link auth-layer api-routes ui-components   # create or update a stack
gh stack link 7 ui-polish                           # append to stack 7
gh stack link --base develop auth-layer api-routes  # non-default trunk
```

It needs at least two arguments, or a stack number plus what to append, and only ever adds to a stack. `--open` marks new and existing PRs ready for review.

Open the PR yourself with `gh pr create --base <parent>` before linking whenever the title and body matter. `link` reuses an open PR when it finds one, and auto-generates a title from the commit subject or branch name for the ones it creates. There is no editor here, which is the main thing `submit` has that `link` doesn't.

## Merging

`gh pr merge` does not work on a stacked PR. Use `gh stack merge`, which takes a stack number or a PR number, never a URL, and works under either layout.

```bash
gh stack merge 42 --yes --<method>  # everything up to and including PR #42
gh stack merge 7 --yes --<method>   # stack 7, no local checkout needed
```

`--yes` runs it headlessly. Name the method rather than inheriting the default, which is whichever one you used last, and take it from the repo (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`). With no argument it takes the stack for the current branch. Give it a number instead. The merge should not turn on what happens to be checked out.

The merge is all-or-nothing across every PR at or below the target. One layer that can't merge sinks the call, and the reason comes back on stderr. Layers above stay open, and GitHub retargets and rebases them onto the new base. Pull that down afterward (`gh stack sync` under native tracking, the external tool otherwise), because every open layer is stale locally until you do.

Only open-and-not-draft state is checked before submitting. GitHub evaluates branch protection and repository rules when the merge runs, and those requirements can't be bypassed for a stack.

When the base branch uses a merge queue, the stack goes on the queue instead of merging directly. The queue picks the method and ignores any method flag with a warning, and the PRs enter together but land as the queue processes them, possibly in separate groups.

## Switching Layouts

`gh stack checkout <stack-number>` adopts a stack that exists only on GitHub: it queries the API, fetches the branches, and sets up local tracking. This is how a stack published by `link` becomes natively tracked, and it wants a working tree the branches can all be checked out in.

`gh stack unstack --local` drops local tracking and leaves the stack on GitHub, which is the reverse. Without `--local`, `unstack` also unstacks on GitHub, and takes a stack number to do that from anywhere. GitHub keeps PRs stacked when they are queued or have auto-merge enabled.
