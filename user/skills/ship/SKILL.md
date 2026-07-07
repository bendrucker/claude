---
name: ship
disable-model-invocation: true
description: >-
  Finish a branch: infer which review passes the diff warrants, run them, open
  the PR, babysit CI to green, triage bot comments, and refresh the body from a
  clean context. Invoke as /ship when a change is ready to send.
argument-hint: "[--merge] [--effort <level>] [--simplify] [--skip <pass>] [--base <ref>]"
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(git diff:*)
  - Bash(git status:*)
  - Skill(code-review)
  - Skill(simplify)
  - Skill(verify)
  - Skill(comments:audit)
  - Skill(writing:review)
  - Skill(pull-request:create)
  - Skill(pull-request:babysit)
---

# Ship

Finish the current branch with one command. Ship reads the diff, decides which
review passes it warrants, runs them in sequence, opens the PR, watches CI to
green, and refreshes the body from a clean context.

Ship is a decider and sequencer, not a worker. Each pass it runs fans out on its
own (`code-review`, `simplify`, `comments:audit`, `writing:review`, `verify`, and
`pull-request:babysit` all dispatch their own agents or watchers). Ship's job is
to gate the optional passes so the diff only pays for the reviewers it earns, then
run the finishing sequence in the right order.

The default end state is **green and ready**: CI passing, bot comments triaged,
body refreshed, stopped for your own web review. `--merge` opts into driving the
PR all the way to merged.

## Context

Gathered at invocation with bang-execution, so the decide step reads it without a
tool call:

- Working tree and untracked files: !`git status --short`

This is base-independent. The committed diff needs a base, resolved below.

## Decide What Applies

Resolve the base before diffing. It defaults to `main`. On a stacked branch pass
`--base <parent>` so gating sees only the tip layer. Diff the tip against the base
with `git diff <base>...HEAD`.

Gate each pass on what the change contains. Read the Context above for the
working-tree state, then run `git diff <base>...HEAD` (plus a plain `git diff` for
uncommitted work) for the file set, its size, and the content behind any judgment
call: whether the diff introduces code comments, whether a code change is a pure
refactor. The full matrix, the effort-inference table, and the
`code-review`-versus-`simplify` heuristic live in
[`references/passes.md`](references/passes.md). The short version:

- **Correctness and quality** runs when the diff changes code, as exactly one of
  `code-review <effort> --fix` (default) or `simplify` (pure refactor with no new
  behavior). A docs-only or config-only diff skips it.
- **`comments:audit`** runs when the diff introduces code comments.
- **`writing:review`** runs when the diff touches prose (`.md`, `.mdx`, `.rst`,
  docs).
- **`verify`** runs when the diff has a runtime surface. It declines tests-only
  and docs-only diffs on its own, so passing it a docs change is a no-op, not a
  failure.

Infer, don't interrogate. Present the plan in one line and proceed:

> Ship plan: `code-review medium --fix` → `verify` → create → babysit. Skipping
> comments (no new comments) and writing (no prose).

Use `AskUserQuestion` only when a call is genuinely ambiguous: a diff that could
be a refactor or a behavior change, or an effort that could be `medium` or
`high`. One question, then run.

## Flags

- `--merge` drives the PR to merged (babysit `--merge`). Default is green and
  ready.
- `--effort <low|medium|high|max|ultra>` overrides the inferred `code-review`
  effort.
- `--simplify` forces the `simplify` path over `code-review`.
- `--skip <pass>` drops a gated pass. Repeatable. Pass names: `code-review`,
  `simplify`, `comments`, `writing`, `verify`.
- `--base <ref>` sets the diff base for gating. Default `main`. On a stack, pass
  the parent branch so gating sees only the tip layer.

## Pre-PR Reviews

Run the gated review passes before creating the PR, serialized. `code-review
--fix`, `simplify`, and the comment trims all write to the branch, so they cannot
apply in parallel.

Order:

1. **`comments:audit`** first, because it needs a clean working tree and lands
   its trims through a branch fast-forward (see [Comment
   Trims](#comment-trims)). The other fix passes dirty the tree, so running the
   comment pass first keeps the tree clean for it. This pass pauses at preflight
   for an agent-count approval, so it interrupts the otherwise unattended flow.
2. **Correctness and quality**: `code-review <effort> --fix` or `simplify`. These
   apply their own fixes to the working tree.
3. **`writing:review`** over the touched prose. It surfaces prose findings.
   Address the salient ones before the body is written.
4. **`verify`** to exercise the change end to end.

If the working tree is dirty when ship reaches the comment pass, say so and ask
whether to commit first. `comments:audit` operates on `HEAD` and requires a clean
working tree, so the branch's changes must be committed for it to land the trims.

#### Comment Trims

`comments:audit` commits its trims to a fresh `comments/audit-<hash>` branch off
`HEAD` and leaves the working tree untouched. Ship needs those trims on the
shipping branch. Run `comments:audit --base <base> --fix` and capture the branch
name it prints.

When the audit finds nothing to trim it writes no branch. There is nothing to
fast-forward, so skip this step. Only when a branch name was printed, dispatch a
short-lived `general-purpose` Agent, passing it that name, to fast-forward the
shipping branch onto the audit commit and delete the temp branch:

```
git merge --ff-only comments/audit-<hash>
git branch -d comments/audit-<hash>
```

The fast-forward is always clean, since the audit commit sits directly on `HEAD`.
The merge runs in the dispatched Agent so ship's own commands stay `git diff` and
`git status`. See [`references/passes.md`](references/passes.md) for the rejected
alternatives.

## Create

Run `pull-request:create` to commit the accumulated working-tree fixes, push, and
open the PR. Capture the PR URL it prints. The babysit and body-refresh steps
both need it.

## Babysit

Run `pull-request:babysit <url>` to watch CI and fix trivial failures until
green.

- Add `--reviews` so babysit hands bot comments to `pull-request:follow-up
  --auto` after the first green. Default this on: bot review triage is part of
  finishing.
- Add `--merge` only when `/ship --merge` was passed. Without it, babysit stops
  at green and ready.

Babysit owns the follow-up loop and the CI waits. Ship does not poll on its own.

## Refresh the Body

Dispatch a background `general-purpose` Agent to run `pull-request:update <url>`,
on a cheaper model when one is set. It reads the final PR and the merged diff, not
this session's transcript. Use `general-purpose`, never `fork`: a fork inherits
this context and would reintroduce the diary narration.

This is what kills the diary effect. The rewriter never saw the review
back-and-forth, so it describes the merged diff as a finished change, with no
"initially" or "after review". The cheaper out-of-context model also cuts the
rewrite's cost.

## Report

Close with the PR link, which passes ran and which were gated out, and the final
state (green and ready, or merging).
