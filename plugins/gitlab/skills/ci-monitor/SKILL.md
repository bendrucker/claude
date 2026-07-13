---
name: gitlab:ci-monitor
description: Investigate GitLab CI pipeline failures and extract diagnostics. Use when watching MR CI, branch builds, or specific pipelines.
argument-hint: "[mr-url | branch | pipeline-id] [--max-minutes N] [--project group/project]"
effort: low
allowed-tools:
  - Monitor
  - TaskStop
  - Agent
  - Bash(bun:*)
  - Bash(glab ci:*)
  - Bash(glab api:*)
  - Bash(glab mr view:*)
  - Bash(git remote:*)
  - Bash(jq:*)
---

# CI Monitor

Watch a GitLab pipeline (for an MR, a branch, or a specific pipeline ID), reacting to failures by dispatching the `gitlab:logs` agent for diagnostics. Exits cleanly when the pipeline is green, the MR is closed, a pipeline-id target reaches a terminal status, or the wall-clock cap is hit.

## Target

$ARGUMENTS

Accepts an MR URL, a branch name, a pipeline ID, or derives one from the current branch:

- MR mode: pass a URL like `https://gitlab.com/group/project/-/merge_requests/123`.
- Branch mode: pass a branch name (e.g. `main`, a release branch). Project path `group/project` is inferred from `git remote get-url origin` in the current directory; pass `--project <group/project>` to override.
- Pipeline-id mode: pass a pipeline ID (e.g. from a manually-triggered pipeline or a re-run). Project is inferred from the git remote; override with `--project <group/project>`.
- No argument: derive an MR URL from the current branch: `glab mr view --output json | jq -r '.web_url'`.

## Workflow

#### Start the monitor

Launch the watch script via the `Monitor` tool with `persistent: true`:

- MR mode: `bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --mr <mr-url>`
- Branch mode: `bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --branch <name> [--project <group/project>]`
- Pipeline-id mode: `bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --pipeline-id <id> [--project <group/project>]`
- Optional flags: `--interval <seconds>`, `--max-minutes <N>`, `--queued-timeout <minutes>`, `--api-error-threshold <N>`.

Exactly one of `--mr`, `--branch`, or `--pipeline-id` is required. In branch and pipeline-id modes, `--project` is inferred from the current git remote when omitted. Pipeline-id mode queries `glab api projects/:id/pipelines/:pid` directly; if the pipeline does not exist the watcher exits non-zero on the first call.

The script emits one JSON object per line on stdout. When the first probe is already green, it emits a single `status: success` event and exits, so there is no separate initial-green path. In pipeline-id mode it also exits after emitting `status: failing`, because a specific pipeline has a finite lifetime and will not restart on its own.

#### Event schema

Each line is one of:

- `{"type":"status","state":"running|failing|success","sha":"...","run_id":"..."}`: `run_id` is the GitLab pipeline ID.
- `{"type":"conflicts","sha":"..."}`: MR reports merge conflicts against the target branch. MR mode only.
- `{"type":"mergeable-unknown","sha":"..."}`: GitLab could not settle merge status after bounded re-polling. MR mode only.
- `{"type":"queued-timeout","minutes":N}`: pipeline has been queued longer than the threshold.
- `{"type":"api-error","consecutive":N}`: consecutive `glab` failures crossed the threshold.
- `{"type":"rate-limited","retry_after":"..."}`: emitted only when `glab` surfaces structured rate-limit data.
- `{"type":"pr-closed"}`: MR closed without merging, or the source branch was deleted. MR mode only. The script exits after emitting.
- `{"type":"merged"}`: MR merged. MR mode only. The script exits after emitting.
- `{"type":"max-time-reached","minutes":60}`: wall-clock cap hit. The script exits after emitting.

In branch and pipeline-id modes, `conflicts`, `mergeable-unknown`, `pr-closed`, and `merged` are never emitted (there is no MR metadata to derive them from). `merged` and `pr-closed` are distinct terminal events: `merged` means the MR landed, `pr-closed` means it closed without merging.

The script exits on `status: success` in every mode. In pipeline-id mode it also exits on `status: failing` (the pipeline is terminal).

#### React to events

On `status: failing`, invoke the `gitlab:logs` agent via the `Agent` tool with the pipeline ID from `run_id`. This applies to all three modes; the logs agent accepts a pipeline ID, so pipeline-id mode fits:

```
Agent(
  subagent_type="gitlab:logs",
  model="haiku",
  prompt="Fetch failing-job logs for pipeline <run_id>. Return the JSON summary described in the logs agent definition."
)
```

Surface the summary to the parent conversation. Do not attempt fixes; `pull-request:babysit` owns that decision.

On `conflicts`, report the SHA with conflicts and stop watching; conflict resolution belongs to the caller.

On `mergeable-unknown`, report the SHA; the caller decides whether to run an authoritative local check.

On `queued-timeout`, `api-error`, or `rate-limited`, surface the event once and keep the monitor running. Consecutive rate-limit or api-error events mean the monitor should be stopped manually.

On `merged`, `pr-closed`, or `max-time-reached`, the monitor has already exited. Report and finish.

#### Stopping

The monitor exits on its own for `status: success`, `merged`, `pr-closed`, and `max-time-reached`. In pipeline-id mode it also exits on `status: failing`. To stop earlier (e.g. after surfacing a failure summary to the user), call `TaskStop` on the monitor task.

## Reference

See [references/log-parsing.md](references/log-parsing.md) for how the `gitlab:logs` agent narrows long job traces via ANSI `section_start`/`section_end` markers.
