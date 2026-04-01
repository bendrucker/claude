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
- Provider: !`bun ${CLAUDE_PLUGIN_ROOT}/../../scripts/detect-provider.ts`
- Start SHA: !`git rev-parse HEAD`

## Determine Interval

Query recent CI durations to pick a polling interval:
- **github**: `gh run list --branch <branch> --limit 5 --json createdAt,updatedAt`
- **gitlab**: `glab ci list --output json`, compute from created/finished timestamps

Average duration + 30s buffer, clamped to 1-10m. Default 3m. Convert to cron (e.g., `*/3 * * * *`).

## Pre-Check

Check if CI is already green or failing before scheduling. If green, report and stop. If failing, fix trivial issues first.

## Schedule

Use `CronCreate` with the computed interval. Build a self-contained prompt that:

1. Runs the state script to increment the iteration: `bun ${CLAUDE_SKILL_DIR}/scripts/state.ts ${CLAUDE_SESSION_ID}`
2. Checks CI (`gh run list` or `glab ci status`)
3. Branches:
   - **Green**: `CronDelete`, clean state (`bun ${CLAUDE_SKILL_DIR}/scripts/state.ts ${CLAUDE_SESSION_ID} clean`), summarize iterations and commits since start SHA
   - **Running**: Do nothing
   - **Failing**: Diagnose with `/github:actions-monitor` or `/gitlab:ci-monitor`, classify, fix if trivial, commit and push
   - **Max iterations** (20): `CronDelete`, report, clean state
4. Avoids `xargs`, `$()`, and pipes that trigger permission prompts

Resolve `${CLAUDE_SKILL_DIR}` and `${CLAUDE_SESSION_ID}` to absolute values in the prompt. The cron runs in the main conversation, not a skill context.

## Fix Classification

**Trivial** (fix and push): lint, type errors, formatting, missing imports, simple test updates

**Non-trivial** (cancel cron, report to user): logic bugs, design issues, flaky tests, environment-dependent failures
