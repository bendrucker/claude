---
name: ship
description: >-
  Finish a branch: infer which review passes the change warrants, run them, open the PR, babysit CI to green, triage bot comments, and refresh the body from a clean context.
argument-hint: "[--merge] [--effort <level>] [--simplify] [--skip <pass>] [--base <ref>]"
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(git diff:*)
  - Bash(git status:*)
  - Bash(git fetch:*)
  - Bash(git rev-parse:*)
  - Skill(plan:review)
  - Skill(review:code)
  - Skill(simplify)
  - Skill(run)
  - Skill(comments:audit)
  - Skill(writing:review)
  - Skill(pull-request:create)
  - Skill(pull-request:babysit)
  - Skill(pull-request:follow-up)
---

# Ship

Gate review passes on the diff, run them in order, open the PR, babysit CI to green, refresh the body from a clean context. Each pass fans out on its own; ship only gates and orders.

Default end state **green and ready**: CI green, bot comments triaged, body refreshed, stopped for your web review. `--merge` drives to merged.

## Context

- Working tree: !`git status --short`

## Decide What Applies

Resolve the base to a **remote** ref so ship's view matches what the PR merges against. From the base branch (default `main`, or `--base <parent>` on a stack), take its tracking ref via `git rev-parse --abbrev-ref --symbolic-full-name <base>@{u}`, falling back to `origin/<base>`. Fetch it first (`git fetch`) so a stale local `<base>` never inflates the diff with already-merged commits. Diff `git diff <resolved>...HEAD`, plus a plain `git diff` for uncommitted work, and thread the resolved ref as `--base` to every gated pass (including `review:code`). Gate each pass on the file set, its size, and the content behind any judgment call (new comments, refactor or new behavior). Full matrix and heuristics: [`references/passes.md`](references/passes.md).

- **`plan:review`**: a substantial approved plan is in context (`~/.claude/plans/` file) *and* the session ran long or redirected enough that the diff could have drifted from it. Skip otherwise ([full gate](references/passes.md)).
- **Correctness and quality**: code changed. Exactly one of `review:code <effort> --fix` (default) or `simplify` (pure refactor, no new behavior). Skip on docs/config-only.
- **`comments:audit`**: diff adds code comments.
- **`pull-request:follow-up --local`**: a supported review bot is available for the repo *and* the diff clears the [Bot Review Gate](references/passes.md). Runs the hosted reviewer locally before the PR exists.
- **`writing:review`**: diff touches prose (`.md`, `.mdx`, `.rst`, docs).
- **`run`**: diff has a runtime surface. Drive the change in the real app, not just tests. Skip on docs-only and tests-only.

Infer, don't interrogate. Present the plan in one line, then proceed. `AskUserQuestion` only on a real toss-up: refactor versus behavior change, or `medium` versus `high` effort.

## Flags

- `--merge`: drive to merged (babysit `--merge`). Default: green and ready.
- `--effort <low|medium|high|xhigh|max|ultra>`: override inferred `review:code` effort. `ultra` is a billed cloud review only a user-typed `/code-review ultra` can start, so ship stops and hands it back instead of substituting a local level.
- `--simplify`: force `simplify` over `review:code`.
- `--skip <pass>` (repeatable): drop a gated pass. Names: `plan`, `review:code` (the old `code-review` is accepted as an alias), `simplify`, `comments`, `bot`, `writing`, `run` (the old `verify` is accepted as an alias).
- `--base <ref>`: base branch for gating. Default `main`; on a stack, the parent branch. Resolved to its upstream tracking ref (e.g. `origin/...`) before diffing.

## Pre-PR Reviews

Serialized before create: `review:code --fix`, `simplify`, and comment trims all write to the branch. `plan:review`, when gated in, is read-only, so it runs as a background dispatch alongside these and joins before create rather than gating them. [`references/passes.md`](references/passes.md) has the DAG.

1. **`comments:audit`**: needs a clean tree (the fix passes dirty it), lands trims via fast-forward (see [Comment Trims](#comment-trims)). Pauses at preflight for an agent-count approval.
2. **`pull-request:follow-up --local`**: reviews committed work only and commits its own fixes, so it runs while the tree is still clean, before the fix passes. Pass the resolved base.
3. **Correctness and quality**: `review:code <effort> --fix` or `simplify`.
4. **`writing:review`** over touched prose. Address salient findings before the body is written.
5. **`run`** to drive the change end to end.

Dirty tree at the comment pass: ask whether to commit first. `comments:audit` operates on `HEAD` and needs a clean tree.

#### Comment Trims

`comments:audit` commits trims to a fresh `comments/audit-<hash>` branch off `HEAD`, leaving the tree untouched. Run `comments:audit --base <base> --fix` and capture the branch name. No branch means nothing to trim: skip. Otherwise dispatch a short-lived `general-purpose` Agent with that name to fast-forward and delete it (rationale and rejected alternatives: [`references/passes.md`](references/passes.md)):

```
git merge --ff-only comments/audit-<hash>
git branch -d comments/audit-<hash>
```

## Create

Join the background `plan:review` first if it was gated in. Act on fix-worthy drift before the PR exists, and carry any deferred follow-ups into the report. Then `pull-request:create` commits the working-tree fixes, pushes, opens the PR. Capture the URL: babysit and body-refresh need it.

Pass `--base <parent>` through when `/ship --base` named a stack parent. Create needs it to target the PR at the parent and to link the layer into the stack on GitHub. Without it the PR opens against the default branch and carries every lower layer's diff.

Pass `--label review` only when the [Bot Review Gate](references/passes.md) routed to the hosted channel (local CLI unavailable); the review then starts with the PR. A local pass already covered the diff, so labeling after it pays a second credit for the same review.

## Babysit

`pull-request:babysit <url>` watches CI and fixes trivial failures to green.

- `--reviews` (default on): after first green, hand bot comments to `pull-request:follow-up --auto`. Covers a bot review landing after the green push with no CI event to key off ([why](references/passes.md)).
- `--merge`: only when `/ship --merge` was passed; else stop at green.

## Refresh the Body

Dispatch a background `general-purpose` Agent (cheaper model if set) to run `pull-request:update <url>` on every run that opened a PR. Never `fork`: it must read the final PR and diff cold, not this session's transcript, so the body describes the finished change with no review narration.

## Report

PR link, passes run and gated out, final state (green and ready, or merging), and whether the body refresh was dispatched.
