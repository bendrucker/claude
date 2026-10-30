---
name: gitlab:ci-monitor
description: Watch GitLab CI and investigate pipeline failures. Use when a pipeline or job is failing or red, when watching MR CI, branch builds, or a specific pipeline, when waiting for CI to go green, or when authoring or validating .gitlab-ci.yml.
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

Watch a GitLab pipeline and report its outcome to the caller: green, a failure diagnosis, or the event that ended the watch. Done when the watcher has exited or been stopped and the outcome is reported.

## Target

$ARGUMENTS

- MR URL (`https://gitlab.com/group/project/-/merge_requests/123`): `--mr <url>`
- Branch name: `--branch <name>`
- Pipeline ID: `--pipeline-id <id>`
- No argument: use the current branch's MR from `glab mr view --output json | jq -r '.web_url'`.

Branch and pipeline-id modes infer the project from the git remote. Pass `--project <group/project>` to override.

## Watch

Run the watcher with the `Monitor` tool and `persistent: true`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts --mr <url> | --branch <name> | --pipeline-id <id> [--project <group/project>]
```

Optional flags: `--interval <seconds>`, `--max-minutes <N>`, `--queued-timeout <minutes>`, `--api-error-threshold <N>`.

The watcher ignores `external` and `parent_pipeline` pipelines. A `success` is confirmed against the pipeline's jobs, so a pipeline reporting success with a failed required job reports `failing`. A pipeline whose jobs cannot be read keeps polling and surfaces as `api-error` if it persists.

## Events

The script prints one JSON object per line. `run_id` is the GitLab pipeline ID.

| Event | Meaning | Watcher exits | Action |
| --- | --- | --- | --- |
| `{"type":"status","state":"running"}` | Pipeline in progress | no | Keep watching |
| `{"type":"status","state":"failing"}` | A job failed | pipeline-id mode only | Dispatch `gitlab:logs` (below) and report its summary |
| `{"type":"status","state":"success"}` | Green, job-confirmed | yes | Report green |
| `{"type":"conflicts","sha":"..."}` | MR conflicts with target | no | Report the SHA and stop the monitor |
| `{"type":"mergeable-unknown","sha":"..."}` | Merge status unsettled | no | Report the SHA |
| `{"type":"queued-timeout","minutes":N}` | Queued past threshold | no | Report once |
| `{"type":"api-error","consecutive":N}` | `glab` failures crossed threshold | no | Report once; stop the monitor if it repeats |
| `{"type":"rate-limited","retry_after":"..."}` | `glab` rate limit | no | Report once; stop the monitor if it repeats |
| `{"type":"merged"}` | MR merged | yes | Report |
| `{"type":"pr-closed"}` | MR closed unmerged or source branch deleted | yes | Report |
| `{"type":"max-time-reached","minutes":N}` | Wall-clock cap | yes | Report |

`conflicts`, `mergeable-unknown`, `merged`, and `pr-closed` occur in MR mode only.

On `failing`, pass `run_id` to the logs agent:

```
Agent(subagent_type="gitlab:logs", prompt="Fetch failing-job logs for pipeline <run_id>. Return the JSON summary described in the logs agent definition.")
```

Report the diagnosis and leave fixes, conflict resolution, and merge checks to the caller (`pull-request:babysit` owns fixes). Stop a running watcher with `TaskStop`.

## Config Authoring

For editing `.gitlab-ci.yml` rather than watching a run:

```bash
glab ci lint               # Validate .gitlab-ci.yml before pushing
glab ci status             # Pipeline status for current branch
glab ci list               # List recent pipelines
glab ci run                # Trigger a pipeline for the current branch
glab ci view               # Interactive pipeline/job view
glab ci trace <job-id>     # Stream job logs
glab ci retry <job-id>     # Retry a failed job
```

Keyword syntax is at <https://docs.gitlab.com/ci/yaml/> and predefined variables at <https://docs.gitlab.com/ci/variables/>.
