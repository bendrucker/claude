---
name: ship
description: >-
  Finish a branch: infer which review passes the change warrants, run them, open the PR, babysit CI to green, triage bot comments, and refresh the body from a clean context.
argument-hint: "[--merge] [--effort <level>] [--simplify] [--human] [--skip <pass>] [--base <ref>]"
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
  - Skill(run)
  - Skill(comments:audit)
  - Skill(github:copilot)
  - Skill(prompting:scan)
  - Skill(prompting:prompting)
  - Skill(writing:review)
  - Skill(review:human)
  - Skill(pull-request:create)
  - Skill(pull-request:babysit)
  - Skill(pull-request:follow-up)
---

# Ship

Gate review passes on the diff, run them in order, open the PR, babysit CI to green, and refresh the body from a clean context. Each pass manages its own fan-out. Ship gates and orders them.

Done means CI green, bot comments triaged, body refreshed, and a stop for your web review. With `--merge`, done means merged.

## Context

- Working tree: !`git status --short`

## Decide What Applies

Diff against the remote base, which is what the PR merges against. Take the base branch (`main`, or the `--base` parent on a stack), `git fetch`, and resolve its tracking ref with `git rev-parse --abbrev-ref --symbolic-full-name <base>@{u}`, falling back to `origin/<base>`. Read `git diff <resolved>...HEAD` plus a plain `git diff` for uncommitted work. Pass the resolved ref as `--base` to every pass that takes it. `code-review` takes the range `<resolved>...HEAD` as its target.

Gate each pass on the file set, its size, and the content behind any judgment call. Gates, effort inference, and the `code-review` versus `simplify` choice: [`references/passes.md`](references/passes.md).

- **`plan:review`**: a substantial approved plan is in context (`~/.claude/plans/` file) and the session ran long or redirected enough for the diff to drift from it.
- **Correctness and quality**: code changed. Exactly one of `code-review <effort> --fix` (default) or `simplify` (pure refactor, no new behavior). Skip on docs- or config-only diffs.
- **`comments:audit`**: the diff adds code comments.
- **`pull-request:follow-up --local`**: a supported review bot is available for the repo and the diff clears the [Bot Review Gate](references/passes.md#bot-review-gate).
- **`github:copilot`**: code changed on a repo I own and the diff clears the [Cross-Model Gate](references/passes.md#cross-model-gate).
- **`prompting:scan`**: the diff touches a document a model executes: `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, a skill's `references/`, `.claude/agents`, `.claude/commands`, `.claude/rules`, or a `prompt/` or `prompts/` dir.
- **`writing:review`**: the diff touches prose people read (READMEs, docs, `.mdx`, `.rst`) outside those prompt files. A diff with both kinds runs both passes, each over its own files.
- **`run`**: the diff has a runtime surface. Skip on docs-only and tests-only diffs.
- **`review:human`**: the diff clears the [Human Review Gate](references/passes.md#human-review-gate), which skips trivial diffs.

State the plan in one line and proceed. Use `AskUserQuestion` only for a real toss-up: refactor versus behavior change, or `medium` versus `high` effort.

## Flags

- `--merge`: drive to merged.
- `--effort <low|medium|high|xhigh>`: override inferred `code-review` effort.
- `--simplify`: force `simplify` over `code-review`.
- `--human`: force `review:human` on a diff the gate skips.
- `--skip <pass>` (repeatable): drop a gated pass. Names: `plan`, `code-review` (alias `review:code`), `simplify`, `comments`, `bot`, `copilot`, `prompting`, `writing`, `run` (alias `verify`), `human`.
- `--base <ref>`: base branch, the parent branch on a stack. Default `main`.

## Pre-PR Reviews

Run the gated passes in this order. The fix passes write to the branch, so they run serially. When `plan:review` is gated in, dispatch it in the background at the start, since it is read-only, and join it before `review:human`.

1. **`comments:audit`**: needs a clean tree, so it runs first. See [Comment Trims](#comment-trims).
2. **`pull-request:follow-up --local`** with the resolved base: reviews committed work and commits its own fixes, so it runs while the tree is still clean.
3. **`github:copilot`**: same slot, same reason. Triage findings and fix in-branch.
4. **`code-review <effort> --fix`** or **`simplify`**.
5. **`prompting:scan`** over touched prompt files. Fix confirmed findings with the `prompting` skill.
6. **`writing:review`** over touched human prose. Address salient findings.
7. **`run`**: drive the change in the real app, end to end.
8. **Join `plan:review`**: act on fix-worthy drift. Carry deferred follow-ups into the report.
9. **`review:human`**: last, so Ben reads the cleaned diff. It ends the turn, and Create runs when the review resumes with approval.

When the tree is dirty at the comment pass, ask whether to commit first.

#### Comment Trims

Run `comments:audit --base <base> --fix`. It commits trims to a fresh `comments/audit-<hash>` branch off `HEAD` and prints the name. No branch printed means nothing to trim. Otherwise land and delete it:

```
git merge --ff-only comments/audit-<hash>
git branch -d comments/audit-<hash>
```

## Create

Run `pull-request:create`, which commits the working-tree fixes, pushes, and opens the PR. Capture the URL for babysit and the body refresh.

- `--no-review-body` whenever `review:human` did not run.
- `--base <parent>` when `/ship --base` named a stack parent, so the PR targets the parent and links into the stack.
- `--label review` only when the [Bot Review Gate](references/passes.md#bot-review-gate) routed to the hosted channel. After a local pass, the label pays a second credit for the same review.

## Babysit

Run `pull-request:babysit <url> --reviews`, which fixes trivial CI failures to green and then hands bot comments to `pull-request:follow-up --auto`. Add `--merge` only when `/ship --merge` was passed.

## Refresh the Body

On every run that opened a PR, dispatch a background `general-purpose` Agent (cheaper model if set) to run `pull-request:update <url>`. Start it fresh, not as a `fork`, so it reads the final PR and diff cold and the body describes the finished change.

## Report

PR link, passes run and gated out, final state (green and ready, or merging), deferred `plan:review` follow-ups, and whether the body refresh was dispatched.
