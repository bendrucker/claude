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
  - Skill(code-review)
  - Skill(simplify)
  - Skill(verify)
  - Skill(comments:audit)
  - Skill(writing:review)
  - Skill(pull-request:create)
  - Skill(pull-request:babysit)
---

# Ship

Gate review passes on the diff, run them in order, open the PR, babysit CI to green, refresh the body from a clean context. Each pass fans out on its own; ship only gates and orders.

Default end state **green and ready**: CI green, bot comments triaged, body refreshed, stopped for your web review. `--merge` drives to merged.

## Context

- Working tree: !`git status --short`

## Decide What Applies

Resolve the base to a **remote** ref so ship's view matches what the PR merges against. From the base branch (default `main`, or `--base <parent>` on a stack), take its tracking ref via `git rev-parse --abbrev-ref --symbolic-full-name <base>@{u}`, falling back to `origin/<base>`. Fetch it first (`git fetch`) so a stale local `<base>` never inflates the diff with already-merged commits. Diff `git diff <resolved>...HEAD`, plus a plain `git diff` for uncommitted work, and thread the resolved ref as `--base` to every gated pass (including `code-review`). Gate each pass on the file set, its size, and the content behind any judgment call (new comments, refactor or new behavior). Full matrix and heuristics: [`references/passes.md`](references/passes.md).

- **`plan:review`**: an approved plan is in context (Claude Code injects a `~/.claude/plans/` file). No plan, skip.
- **Correctness and quality**: code changed. Exactly one of `code-review <effort> --fix` (default) or `simplify` (pure refactor, no new behavior). Skip on docs/config-only.
- **`comments:audit`**: diff adds code comments.
- **`writing:review`**: diff touches prose (`.md`, `.mdx`, `.rst`, docs).
- **`verify`**: diff has a runtime surface. Declines tests-only and docs-only itself.

Infer, don't interrogate. Present the plan in one line, then proceed. `AskUserQuestion` only on a real toss-up: refactor versus behavior change, or `medium` versus `high` effort.

## Flags

- `--merge`: drive to merged (babysit `--merge`). Default: green and ready.
- `--effort <low|medium|high|max|ultra>`: override inferred `code-review` effort.
- `--simplify`: force `simplify` over `code-review`.
- `--skip <pass>` (repeatable): drop a gated pass. Names: `plan`, `code-review`, `simplify`, `comments`, `writing`, `verify`.
- `--base <ref>`: base branch for gating. Default `main`; on a stack, the parent branch. Resolved to its remote tracking ref (`origin/...`) before diffing.

## Pre-PR Reviews

Serialized before create: `code-review --fix`, `simplify`, and comment trims all write to the branch.

1. **`plan:review`** (if gated in). Read-only, so it runs first. Surface its findings; handle fix-before-merge drift now, so the passes below cover the resulting fixes.
2. **`comments:audit`**: needs a clean tree (the fix passes dirty it), lands trims via fast-forward (see [Comment Trims](#comment-trims)). Pauses at preflight for an agent-count approval.
3. **Correctness and quality**: `code-review <effort> --fix` or `simplify`.
4. **`writing:review`** over touched prose. Address salient findings before the body is written.
5. **`verify`** end to end.

Dirty tree at the comment pass: ask whether to commit first. `comments:audit` operates on `HEAD` and needs a clean tree.

#### Comment Trims

`comments:audit` commits trims to a fresh `comments/audit-<hash>` branch off `HEAD`, leaving the tree untouched. Run `comments:audit --base <base> --fix` and capture the branch name. No branch means nothing to trim: skip. Otherwise dispatch a short-lived `general-purpose` Agent with that name to fast-forward and delete it:

```
git merge --ff-only comments/audit-<hash>
git branch -d comments/audit-<hash>
```

The commit sits on `HEAD`, so the fast-forward is clean. It runs in the Agent to keep ship's own commands to `git diff` and `git status`. Rejected alternatives: [`references/passes.md`](references/passes.md).

## Create

`pull-request:create` commits the working-tree fixes, pushes, opens the PR. Capture the URL: babysit and body-refresh need it.

## Babysit

`pull-request:babysit <url>` watches CI and fixes trivial failures to green.

- `--reviews` (default on): after first green, hand bot comments to `pull-request:follow-up --auto`.
- `--merge`: only when `/ship --merge` was passed; else stop at green.

Babysit owns the CI waits and the follow-up loop. Ship never polls.

## Refresh the Body

Dispatch a background `general-purpose` Agent (cheaper model if set) to run `pull-request:update <url>`. Never `fork`: it must read the final PR and diff cold, not this session's transcript, so the body describes the finished change with no review narration.

## Report

PR link, passes run and gated out, final state (green and ready, or merging).
