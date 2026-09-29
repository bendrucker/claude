---
fail: []
---
Title: github,pull-request: support GitHub stacked pull requests

GitHub shipped [stacked pull requests](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/) on 2026-07-30. `gh pr merge` does not work on a stacked PR, and it is the primary merge path in both babysit's merge mode and `pull-request:create`, so either would have failed the first time a stack existed on GitHub.

## Two Layouts

`gh stack` splits into a remote half (`link`, `merge`, `unstack`) that goes through the API and writes no local state, and a local-tracking half (`init`, `add`, `submit`, `push`, `sync`, `rebase`, `checkout`, `modify`, navigation) that assumes every layer of the stack is checked out in one working tree.

Both are supported here, chosen per stack rather than per repository. Native tracking fits a stack under active reshaping, where reordering and folding layers matters more than working two layers at once. External tracking fits layers worked on in parallel or over a long stretch, where each wants its own checkout and running services. `gh stack checkout <stack-number>` adopts a stack that exists only on GitHub, and `gh stack unstack --local` drops tracking without touching it, so a stack can move between them.

What doesn't work is mixing them within one stack. `gh stack rebase` prints `✓ Rebased <branch>` and does nothing when that branch is checked out elsewhere ([gh-stack#35](https://github.com/github/gh-stack/issues/35), still open at v0.1.0).

`user/CLAUDE.md` previously stated one worktree per branch as a flat fact and `wt sync` as the only restack path. It now presents both layouts with what each is good for. `wt sync` plus `gh stack link` and `gh stack sync` are the two halves of the same job.

## Skill Placement

The reference lives at `plugins/github/skills/stack/` as a skill, not as a `stack.md` under `plugins/pull-request/skills/create/`. Two skills in different plugins consume it: `create` publishes the stack and `babysit` merges it, and a reference file under `create/` would need a cross-skill relative path to reach babysit. It mirrors the split this repo already has on GitLab, where `glab stack` mechanics live in `gitlab:merge-request` and the platform-agnostic `pull-request` plugin delegates per platform. A skill is also model-invocable, so "stack these branches" routes to it directly.

## Detection

Under native tracking `gh stack view --short` answers locally. Anything holding a PR number instead of a branch needs the API, and `gh pr view` has no stack field, so detection goes through GraphQL: `pullRequest.stack` returns null when unstacked, and `pullRequest.stackEntry.stack.entries` enumerates the other layers for babysit's pre-flight check. That query is layout-independent, which is why babysit uses it.

## Merge Mode

`gh stack merge` is all-or-nothing across every PR at or below the target, so the pre-flight block check widens from the watched PR to every layer below it. A sibling that is draft or short an approval sinks the whole call, and babysit can't fix another layer's CI, so that case reports and stops.

Re-arm splits by stack membership. `gh stack merge` submits immediately and has no `--auto` to arm ahead of green, so re-submitting straight after a push either fails the branch-protection check or lands unverified code. A stacked PR re-arms at the next `status: success`.

Under a merge queue the stack enters as a unit but lands as the queue processes it, possibly in separate groups. The watcher follows one PR, so its `merged` still means that PR landed and stays the terminal. Lower layers landing first counts as progress and the wait continues.

## Base Branch

`--base <parent>` now threads from `/ship` through `pull-request:create` to `gh pr create`, which a stack layer needs so its PR targets the parent and carries only its own diff. Create opens the PR before calling `gh stack link` so the drafted title and body survive. `link` auto-generates both for PRs it opens itself, and `gh stack submit` collects them in a full-screen editor no tool call can drive, so `gh pr create` stays the path under either layout. On a repo without stacked PRs enabled `link` exits 9, and create leaves the PR alone: the base is already right and the merge takes the ordinary `gh pr merge` path.

Every command and flag is checked against `gh stack <cmd> --help` at v0.1.0, and the GraphQL fields against live schema introspection. Worth knowing from that pass: `gh stack sync` also links open PRs into a stack once two exist, and both `gh stack submit --auto` and `gh stack link` create PRs as drafts unless passed `--open`.
