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

Watch a PR, branch, or specific run's GitHub Actions progress and react to failures by pulling logs through the `github:logs` agent. The monitor handles state tracking, deduplication, and the initial-green fast path; this skill coordinates: it starts the monitor, reacts to events, and stops it.

## Target

`$ARGUMENTS`

Accepted forms:

- A GitHub PR URL (e.g. `https://github.com/owner/repo/pull/42`) runs in **PR mode**.
- A branch name (e.g. `main`) runs in **branch mode**. The script infers the repo from `git remote get-url origin` in the current directory; pass `--repo <owner/repo>` to override.
- A run ID (e.g. `12345678`) runs in **run-id mode**, watching a specific workflow run directly. Covers `workflow_dispatch`, manually-triggered, and re-run cases where the run ID is known. The repo is inferred from the git remote; pass `--repo <owner/repo>` to override.
- No argument: derive the current PR from the current branch with `gh pr view --json url --jq '.url'`. If the branch has no PR, fall back to branch mode with the current branch name.

## Workflow

#### Start the monitor

Invoke `Monitor` with `persistent: true` on the watch script. Pick a mode by flag:

PR mode:

```
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --pr <pr-url>
```

Branch mode:

```
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --branch <name> [--repo <owner/repo>]
```

Run-id mode:

```
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --run-id <id> [--repo <owner/repo>]
```

Exactly one of `--pr`, `--branch`, or `--run-id` must be set. `--repo` applies to branch mode and run-id mode and is inferred from the git remote when omitted.

Optional flags: `--interval <seconds>`, `--max-minutes <N>`, `--queued-timeout <minutes>`, `--api-error-threshold <N>`. Omit `--interval` to let the script derive one from recent run durations in PR/branch mode; run-id mode uses a 180s default.

#### Event schema

The script emits one JSON object per line on stdout:

- `{"type":"status","state":"running|failing|success","sha":"...","run_id":"..."}`
- `{"type":"conflicts","sha":"..."}` (PR mode only)
- `{"type":"mergeable-unknown","sha":"..."}` (PR mode only)
- `{"type":"queued-timeout","minutes":N}`
- `{"type":"api-error","consecutive":N}`
- `{"type":"rate-limited","retry_after":"..."}`
- `{"type":"pr-closed"}` (PR mode only)
- `{"type":"merged"}` (PR mode only)
- `{"type":"max-time-reached","minutes":60}`

`conflicts`, `mergeable-unknown`, `pr-closed`, and `merged` fire only in PR mode; run-id and branch mode never emit them. `merged` and `pr-closed` are distinct terminal events: `merged` means the PR landed, `pr-closed` means it closed without merging. The script exits on `status:success`, `pr-closed`, `merged`, and `max-time-reached`. In run-id mode it also exits on `status:failing`, since a specific run reaches a terminal conclusion with no "next run" to wait for. In PR and branch mode, `failing` is not terminal (the user may push a fix or start another run).

#### React to status:failing

On a `status` event with `state == "failing"`, invoke the `github:logs` agent via the `Agent` tool. Pass the `run_id` and the PR URL (or branch name in branch mode) from the event:

```
Agent({
  subagent_type: "github:logs",
  model: "haiku",
  prompt: "Fetch failing-job logs for run <run_id>. Return the structured JSON summary."
})
```

Use the agent's JSON response to report failures to the user. The agent persists the raw logs to a known temp path; read that file for more context.

#### React to other events

- `conflicts` (PR mode): note the conflicting SHA; the caller (e.g. `pull-request:babysit`) decides whether to resolve.
- `mergeable-unknown` (PR mode): GitHub could not settle mergeability after bounded re-polling. Note the SHA; the caller decides whether to run an authoritative local check.
- `queued-timeout`: surface that a run has been queued past the threshold.
- `api-error`: surface repeated CLI failures so the user can intervene.
- `rate-limited`: back off or stop; retry once the window passes.
- `merged` (PR mode): the PR landed. The script exits on its own.
- `pr-closed` (PR mode): the PR closed without merging, or the branch was deleted. The script exits on its own.
- `max-time-reached`: the wall-clock cap fired. The script exits on its own.

#### Initial-green case

No separate path. If the target is already green at startup, the script emits a single `status:success` event and exits. Report green and stop.

#### Stopping

The monitor exits naturally on `status:success`, `merged` or `pr-closed` (PR mode), `status:failing` (run-id mode only), or `max-time-reached`. To stop early, call `TaskStop` on the monitor task.

## References

Log parsing strategy (shared with `github:logs`): [references/log-parsing.md](references/log-parsing.md).
