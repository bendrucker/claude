---
name: pull-request:babysit
description: |
  Monitor a PR's CI on a recurring interval, fix trivial failures (lint, types, formatting), and self-cancel when green. Use after pushing when you want hands-off CI monitoring with automatic fixes.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(git:*)
  - Bash(bun:*)
  - CronCreate
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

1. Run state script to track iteration (`bun <state-script> <session-id> <pr-number>`)
2. Check CI for the branch
3. **Green**: `CronDelete`, clean state (`bun <state-script> <session-id> <pr-number> clean`), summarize commits since start SHA
4. **Running**: Do nothing
5. **Failing**: Diagnose with `/github:actions-monitor` or `/gitlab:ci-monitor`, fix if trivial, commit and push
6. **Max iterations** (20): `CronDelete`, report, clean state

Resolve all `${}` placeholders to absolute values in the prompt. Avoid `xargs`, `$()`, and pipes.

## Trivial Failures

Lint errors, type errors, formatting, missing imports, simple test updates.

Reproduce locally, fix, verify, commit with a descriptive message, and push.

## Non-Trivial Failures

Logic bugs, design issues, flaky tests, environment-dependent failures.

Cancel the cron job and report the failure details to the user.
