---
name: github:stack
description: Publish and merge GitHub native stacked pull requests with the `gh stack` extension. Use when a branch is stacked on another branch rather than the default branch, when linking a chain of branches into a stack on GitHub, or when merging a PR that belongs to a stack. Load before running any `gh stack` command.
allowed-tools:
  - Bash(gh stack:*)
  - Bash(gh pr:*)
  - Bash(gh api:*)
---

# Stacked Pull Requests

`gh stack` (the `github/gh-stack` extension) drives GitHub's native stacked PRs. The stack object on GitHub and the merge are the same under either layout below. The layouts differ in which tool rebases the branches.

## Layouts

#### Native Tracking

`gh stack` creates the branches, runs the cascading rebase, and publishes, across worktrees. Its commands are in [`references/native-tracking.md`](references/native-tracking.md).

#### External Tracking

Another tool rebases the branches, and `gh stack link` publishes the result without writing local state.

Keep each stack under one layout, so two tools never rebase the same branches.

Read the current state with `gh stack view --short` (add `--json` to parse it). It answers from local tracking. Output means native tracking, and an error means the stack is not tracked in this clone. A stack published by `link` exists on GitHub and is still absent from `view`.

Exit code 9 means the repository doesn't have stacked PRs enabled. Code 6 means a branch belongs to more than one stack, or more than one remote is configured with no `remote.pushDefault` set. `link`, `submit`, `push`, and `sync` take `--remote` for that second case.

Stack numbers and PR numbers share one sequence per repository, so a bare number is unambiguous wherever a command takes either.

## Detection

Stack membership is stored on the API. Given a PR number, this query answers under either layout with nothing checked out.

```bash
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stack{number size}}}}' \
  -F owner=<owner> -F repo=<repo> -F number=<n>
```

`"stack": null` means the PR isn't stacked. Otherwise `number` is the stack number and `size` its PR count. `gh pr view` has no stack field.

To read the other layers, ask for the entries. `position` counts up from the base, so position 1 is the bottom.

```bash
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){stackEntry{position stack{entries(first:50){nodes{position pullRequest{number state isDraft reviewDecision mergeStateStatus}}}}}}}}' \
  -F owner=<owner> -F repo=<repo> -F number=<n>
```

There is no CI field here. `mergeStateStatus` is the proxy. `CLEAN` is mergeable with checks passing. `BLOCKED` is blocked by a rule or a missing review, `UNSTABLE` is a non-passing commit status, `DIRTY` is a conflict, and `BEHIND` is a stale head ref.

## Linking

Let the other tool rebase and push the whole stack first. `link` pushes without force. It rejects a branch whose remote copy has diverged, which is every branch immediately after a rebase.

`gh stack link` takes branches, PR numbers, or PR URLs bottom to top. It pushes each branch, opens a PR for any branch missing one, corrects the base of any PR whose base breaks the chain, and creates or updates the stack object.

```bash
gh stack link auth-layer api-routes ui-components   # create or update a stack
gh stack link 7 ui-polish                           # append to stack 7
gh stack link --base develop auth-layer api-routes  # non-default trunk
```

It needs at least two arguments, or a stack number plus what to append, and only ever adds to a stack. `--open` marks new and existing PRs ready for review.

Open the PR yourself with `gh pr create --base <parent>` before linking whenever the title and body matter. `link` reuses an open PR when it finds one, and auto-generates a title from the commit subject or branch name for the ones it creates. `link` has no editor.

## Merging

`gh pr merge` does not work on a stacked PR. Use `gh stack merge`, which takes a stack number or a PR number, never a URL, and works under either layout.

```bash
gh stack merge 42 --yes --<method>  # everything up to and including PR #42
gh stack merge 7 --yes --<method>   # stack 7, no local checkout needed
```

`--yes` runs it headlessly. Name the method rather than inheriting the default, which is whichever one you used last, and take it from the repo (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`). Always pass a number, so the merge target does not depend on the current branch.

The merge is all-or-nothing across every PR at or below the target. One layer that can't merge sinks the call, and the reason comes back on stderr. Layers above stay open, and GitHub retargets and rebases them onto the new base. Pull that down afterward (`gh stack sync` under native tracking, the external tool otherwise), because every open layer is stale locally until you do.

Only open-and-not-draft state is checked before submitting. GitHub evaluates branch protection and repository rules when the merge runs, and those requirements can't be bypassed for a stack.

When the base branch uses a merge queue, the stack goes on the queue instead of merging directly. The queue picks the method and ignores any method flag with a warning, and the PRs enter together but merge as the queue processes them, possibly in separate groups.
