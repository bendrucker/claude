---
name: github:actions-monitor
description: Monitor GitHub Actions runs and extract failure diagnostics. Use when watching PR CI, branch builds, or specific workflow runs.
argument-hint: "[pr-url | branch | run-id] [--max-minutes N] [--interval S]"
effort: low
allowed-tools:
  - Monitor
  - TaskStop
  - Agent
  - Bash(bun:*)
  - Bash(gh run:*)
  - Bash(gh pr view:*)
  - Bash(gh pr checks:*)
  - Bash(git remote:*)
  - Bash(jq:*)
---

# Actions Monitor

Watch a PR, branch, or workflow run until it reaches a terminal event, and diagnose each failure. The watch script tracks state and deduplicates events. The monitor is done when the script exits or you stop it with `TaskStop`, with every `failing` event diagnosed along the way.

## Target

`$ARGUMENTS` selects the mode:

- A PR URL selects PR mode. It reads owner and repo from the URL and works from any directory.
- A branch name selects branch mode.
- A run ID selects run-id mode, which covers `workflow_dispatch`, manual triggers, and re-runs.
- With no argument, use the current PR from `gh pr view --json url --jq '.url'`. When the branch has no PR, use branch mode on the current branch.

Branch and run-id mode read the repo from `git remote get-url origin`. Pass `--repo <owner/repo>` to override it.

## Start

Run the script under `Monitor` with `persistent: true` and one mode flag:

```
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --pr <pr-url>
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --branch <name> [--repo <owner/repo>]
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --run-id <id> [--repo <owner/repo>]
```

Optional flags are `--interval <seconds>`, `--max-minutes <N>`, `--queued-timeout <minutes>`, and `--api-error-threshold <N>`. Without `--interval`, PR and branch mode derive the interval from recent run durations, and run-id mode polls every 180s.

## Events

The script prints one JSON object per line:

- `{"type":"status","state":"running|failing|success","sha":"...","run_id":"..."}`
- `{"type":"conflicts","sha":"..."}` (PR mode)
- `{"type":"mergeable-unknown","sha":"..."}` (PR mode)
- `{"type":"queued-timeout","minutes":N}`
- `{"type":"api-error","consecutive":N}`
- `{"type":"rate-limited","retry_after":"..."}`
- `{"type":"pr-closed"}` (PR mode, also when the branch is deleted)
- `{"type":"merged"}` (PR mode)
- `{"type":"max-time-reached","minutes":60}`

The script exits on `status:success`, `pr-closed`, `merged`, and `max-time-reached`. Run-id mode also exits on `status:failing`. PR and branch mode keep watching after `failing`, because a new push or run can follow. A target already green at startup emits one `status:success` and exits.

## Reactions

- `failing` with a `run_id`: dispatch the `github:logs` agent with the `run_id` and the PR URL or branch. It returns a JSON summary of the failing jobs and saves the raw logs to a temp path you can read for more detail.
- `failing` with `"run_id": null`: the red check is an external status such as a hosted reviewer or deployment. Name the failing checks from `gh pr checks`.
- `conflicts` and `mergeable-unknown`: report the SHA and leave the response to the caller, such as `pull-request:babysit`. `mergeable-unknown` means GitHub had not settled mergeability after bounded re-polling.
- `queued-timeout` and `api-error`: report them to the user.
- `rate-limited`: wait until `retry_after`, then retry.

For log parsing, see [references/log-parsing.md](references/log-parsing.md).
