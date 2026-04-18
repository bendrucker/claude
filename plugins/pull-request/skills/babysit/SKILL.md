---
name: pull-request:babysit
description: |
  Monitor a PR's CI on a recurring interval, fix trivial failures (lint, types, formatting), and self-cancel when green. Use after pushing when you want hands-off CI monitoring with automatic fixes.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(jq:*)
  - Bash(git:*)
  - Bash(bun:*)
  - Bash(bunx:*)
  - CronCreate
  - CronDelete
---

# Babysit PR

Set up recurring CI monitoring that fixes trivial failures and cancels when green.

## Context

- Branch: !`git branch --show-current`
- Remote URL: !`git remote get-url origin`
- Start SHA: !`git rev-parse HEAD`
- State script: `${CLAUDE_SKILL_DIR}/scripts/state.ts`
- Session: `${CLAUDE_SESSION_ID}`

## Workflow

Query recent CI run durations, add 30s buffer, clamp to 1-10m (default 3m). Check current CI status. If already green, report and stop.

Use `CronCreate` with a self-contained prompt that handles each iteration:

#### Track State

Run state script to track iteration (`bun <state-script> <session-id>`).

#### Check Merge Conflicts

Check for merge conflicts:

- **GitHub**: `gh pr view <number> --json mergeable --jq '.mergeable'`. If the output is `CONFLICTING`, proceed.
- **GitLab**: `glab mr view <iid> --output json | jq -r '.has_conflicts'`. If `true`, proceed.

Identify conflicting files locally: `git merge origin/<base> --no-commit --no-ff`, then `git diff --name-only --diff-filter=U`. Abort with `git merge --abort` after.

Do not pipe CLI JSON output to `python3`, `bun`, or other interpreters for parsing. Use `gh --jq` / `gh --template` or `glab ... --output json | jq` only.

- **Trivial**: Lockfiles (`bun.lock`) or generated files. For lockfiles, delete and regenerate per project convention (e.g., `rm bun.lock && bun install`). Also trivial: conflicts in files the PR modified where the resolution is obvious (both sides added adjacent lines).
- **Non-trivial**: Report the conflicting file list to the user and cancel.

After resolving, commit the merge and push. The next iteration will pick up the new SHA.

#### Check CI

Query the PR's source branch SHA and CI status. Use `/github:actions-monitor` or `/gitlab:ci-monitor` as appropriate for the remote.

Extract the source branch SHA directly from the CLI:

- **GitHub**: `gh pr view <number> --json headRefOid --jq '.headRefOid'`
- **GitLab**: `glab mr view <iid> --output json | jq -r '.sha'`

Compare that SHA against `git rev-parse HEAD`. Pipelines may run on synthetic merge commits whose SHAs never match the branch HEAD — always compare against `headRefOid` / `.sha`, not the run or pipeline SHA.

#### SHA Mismatch

If the source branch SHA does not match `git rev-parse HEAD`, a fix was recently pushed and CI has not started or completed for the new commit yet. Treat this as "waiting" and do nothing.

#### Green

`CronDelete`, clean state (`bun <state-script> <session-id> clean`), summarize commits since start SHA.

#### Running

Do nothing.

#### Failing

Before diagnosing, check whether a fix was already pushed by comparing the PR's source branch SHA to `git rev-parse HEAD`. If HEAD is newer, skip diagnosis and wait for the new run.

Otherwise, diagnose with `/github:actions-monitor` or `/gitlab:ci-monitor`. Check whether the start SHA's CI run had the same failure. If so, this is a pre-existing issue, not a regression introduced by this branch's changes. Report it and cancel rather than attempting a fix.

If the failure is new, attempt a fix if trivial. Before pushing, reproduce the failing CI step locally to verify the fix works. Then commit and push.

After pushing, note the new HEAD SHA. On the next iteration, skip diagnosis until a run matching the new SHA completes.

#### Max Iterations

After 20 iterations: `CronDelete`, report, clean state.

Resolve all `${}` placeholders to absolute values in the prompt. Avoid `xargs` and `$()`. The only pipes permitted are `glab ... --output json | jq ...` — never pipe CLI output to `python3`, `bun`, `node`, or any interpreter for JSON parsing.

## Gotchas

- **No inline JSON parsing.** Do not pipe `gh`/`glab` output to `python3 -c`, `bun -e`, `node -e`, or similar. Use `gh --jq` / `gh --template` (gh has first-class jq support), or `glab ... --output json | jq ...` (glab lacks `--jq` / `--template`). Inline interpreters trigger permission prompts that kill the cron loop.
- **Compare branch SHA, not pipeline SHA.** Pipelines may run on synthetic merge commits whose SHA never matches the branch tip. Extract `headRefOid` (gh) or `.sha` from the MR payload (glab).
- **Trailing `!=` in jq.** The Bash tool escapes `!` to `\!`. Use `| not` (e.g. `select(.x == null | not)`) or pass the filter via heredoc.

## Trivial Failures

Lint errors, type errors, formatting, missing imports, simple test updates, merge conflicts in lockfiles or generated files.

Reproduce locally, fix, verify, commit with a descriptive message, and push.

## Non-Trivial Failures

Logic bugs, design issues, flaky tests, environment-dependent failures.

Cancel the cron job and report the failure details to the user.
