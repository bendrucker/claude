---
name: github:actions-monitor
description: Monitor GitHub Actions runs and extract failure diagnostics. Use when watching PR CI, branch builds, or specific workflow runs.
argument-hint: "[pr-url | branch | run-id] [--max-minutes N] [--interval S]"
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

Watch a PR, branch, or specific run's GitHub Actions progress and react to failures by pulling logs through the `github:logs` agent. The watch script handles state tracking and deduplication. This skill starts it, reacts to events, and stops it.

## Target

`$ARGUMENTS`

- A GitHub PR URL runs in **PR mode**. Owner and repo come from the URL, so PR mode works from any working directory.
- A branch name runs in **branch mode**.
- A run ID runs in **run-id mode**, watching a specific workflow run directly (covers `workflow_dispatch`, manual triggers, and re-runs).
- No argument: derive the current PR with `gh pr view --json url --jq '.url'`. If the branch has no PR, fall back to branch mode with the current branch name.

Branch and run-id mode infer the repo from `git remote get-url origin`; pass `--repo <owner/repo>` to override.

## Workflow

#### Start the monitor

Invoke `Monitor` with `persistent: true` on the watch script, with exactly one mode flag:

```
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --pr <pr-url>
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --branch <name> [--repo <owner/repo>]
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --run-id <id> [--repo <owner/repo>]
```

Optional flags: `--interval <seconds>`, `--max-minutes <N>`, `--queued-timeout <minutes>`, `--api-error-threshold <N>`. Omit `--interval` to let the script derive one from recent run durations in PR/branch mode; run-id mode uses a 180s default.

#### Event schema

The script emits one JSON object per line on stdout:

- `{"type":"status","state":"running|failing|success","sha":"...","run_id":"..."}`
- `{"type":"conflicts","sha":"..."}` (PR mode only)
- `{"type":"mergeable-unknown","sha":"..."}` (PR mode only)
- `{"type":"queued-timeout","minutes":N}`
- `{"type":"api-error","consecutive":N}`
- `{"type":"rate-limited","retry_after":"..."}`
- `{"type":"pr-closed"}` (PR mode only; also fires if the branch is deleted)
- `{"type":"merged"}` (PR mode only)
- `{"type":"max-time-reached","minutes":60}`

If the target is already green at startup, the script emits a single `status:success` and exits.

The script exits on `status:success`, `pr-closed`, `merged`, and `max-time-reached`. In run-id mode it also exits on `status:failing`, since a specific run reaches a terminal conclusion with no "next run" to wait for. In PR and branch mode, `failing` is not terminal (the user may push a fix or start another run). To stop early, call `TaskStop` on the monitor task.

#### React to events

On a `status` event with `state == "failing"`, invoke the `github:logs` agent via the `Agent` tool, passing the `run_id` and the PR URL (or branch name) from the event. It returns a structured JSON summary of the failing jobs and persists the raw logs to a known temp path; read that file for more context.

A failing event with `"run_id": null` means no Actions run failed: the red check is an external status (a hosted reviewer, a deployment) with no job logs to fetch. Skip the `github:logs` dispatch and name the failing checks from `gh pr checks` instead.

- `conflicts` / `mergeable-unknown` (PR mode): note the SHA; the caller (e.g. `pull-request:babysit`) decides whether to resolve or run an authoritative local check. `mergeable-unknown` means GitHub could not settle mergeability after bounded re-polling.
- `queued-timeout` / `api-error`: surface to the user.
- `rate-limited`: back off and retry once the window passes.

## References

Log parsing strategy (shared with `github:logs`): [references/log-parsing.md](references/log-parsing.md).
