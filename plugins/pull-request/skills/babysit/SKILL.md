---
name: pull-request:babysit
description: |
  Monitor a PR's CI status on a recurring interval, fix trivial failures (lint, types, formatting), and self-cancel when green. Use after pushing to a PR when you want hands-off CI monitoring with automatic fixes. Delegates scheduling to CronCreate.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Skill
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(git:*)
  - Bash(bun:*)
  - CronCreate
  - CronDelete
---

# Babysit PR

Monitor CI, fix trivial failures, repeat until green.

## Current Branch

!`git branch --show-current`

## Workflow

## State

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/babysit/scripts/state.ts ${CLAUDE_SESSION_ID}`

Branch on `iteration` and `max_reached` from the state output above.

### Guidelines

- Use simple, direct commands. Avoid pipes with `xargs` or command substitution with `$()`, they trigger permission prompts.
- Push with `git push`, not via `gh`.

### First run (iteration: 0)

#### Determine polling interval

Query recent CI run durations to pick a smart interval:

- **GitHub**: `gh run list --branch <branch> --limit 5 --json createdAt,updatedAt`
- **GitLab**: `glab ci list --output json` and compute duration from created/finished timestamps

Calculate average duration, add 30 seconds buffer, clamp to 1m-10m range. Fall back to 3m if no data. Convert to a cron expression (e.g., 3m becomes `*/3 * * * *`).

#### Check CI

Delegate to the appropriate CI monitor skill based on the `provider` field:

- **github**: Use the `github:actions-monitor` skill via the Skill tool
- **gitlab**: Use the `gitlab:ci-monitor` skill via the Skill tool

#### Handle result

If CI is green, clean up (see "Green" below). If failing, attempt a fix (see "Failing" below). If still running, proceed to schedule.

#### Schedule recurring check

Use `CronCreate` with:
- `cron`: the expression from the interval calculation
- `prompt`: `"/pull-request:babysit"`

Write the returned job ID into the state file:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/state.ts ${CLAUDE_SESSION_ID} set cron_job_id <JOB_ID>
```

### Max iterations reached (max_reached: true)

Cancel the cron job with `CronDelete` using the `cron_job_id` from state. Clean up: `bun ${CLAUDE_SKILL_DIR}/scripts/state.ts ${CLAUDE_SESSION_ID} clean`. Report:
- Total iterations used
- Current CI status
- Any commits made: `git log <start_sha>..HEAD --oneline`

### Subsequent runs

#### Check CI

Delegate to the CI monitor skill (same as first run).

#### Green

All checks passing. Cancel the cron job with `CronDelete` using the `cron_job_id`. Remove the state file. Summarize:
- Iterations used
- Commits made: `git log <start_sha>..HEAD --oneline`

#### Running/pending

CI is still in progress. Do nothing. The next cron fire will check again.

#### Failing

Diagnose the failure from the CI monitor output.

**Classify the failure:**

Trivial (fix and push):
- Lint errors
- Type errors
- Formatting violations
- Missing imports
- Simple test assertion updates

Non-trivial (report and stop):
- Logic bugs
- Design issues
- Flaky tests with unclear cause
- Failing integration tests that need environment changes

**For trivial failures:**
1. Reproduce locally by running the failing command
2. Fix the issue
3. Verify the fix passes locally
4. Commit with a descriptive message and push

**For non-trivial failures:**
1. Cancel the cron job with `CronDelete`
2. Remove the state file
3. Report the failure details to the user
