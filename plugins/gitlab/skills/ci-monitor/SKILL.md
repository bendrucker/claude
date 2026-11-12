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

Optional flags: `--max-minutes <N>`, `--queued-timeout <minutes>`, `--api-error-threshold <N>`.

## Events

The script prints one JSON object per line. `run_id` is the GitLab pipeline ID. It exits on `success`, `fatal` (a 401, 403, or 404 from `glab`), `merged`, `pr-closed`, and `max-time-reached`. Report each event once.

- `status` `running`: keep watching.
- `status` `failing`: dispatch `gitlab:logs` (below) and report its summary. A retried job reports `running` next.
- `status` `success`: report green.
- `conflicts`: report the SHA and stop the monitor.
- `mergeable-unknown`, `queued-timeout`, `api-error`, `blocked` (waiting on a manual job), `fatal`, `merged`, `pr-closed`, `max-time-reached`: report it.

On `failing`, pass `run_id` and the project path (from `--project` or the MR URL) to the logs agent:

```
Agent(subagent_type="gitlab:logs", prompt="Fetch failing-job logs for pipeline <run_id> in project <group/project>. Return the JSON summary described in the logs agent definition.")
```

Report the diagnosis and leave fixes, conflict resolution, and merge checks to the caller (`pull-request:babysit` owns fixes). Stop a running watcher with `TaskStop`.

## Config Authoring

For editing `.gitlab-ci.yml` rather than watching a run:

```bash
glab ci lint                                       # Validate .gitlab-ci.yml before pushing
glab ci lint --dry-run --include-jobs [--ref <b>]  # Simulate pipeline creation and list its jobs
glab ci config compile                             # Merged config with includes resolved
glab ci get [-p <pipeline-id> | --merge-request <iid>] [--status failed] -F json
glab ci run                                        # Trigger a pipeline for the current branch
glab ci trace <job-id>                             # Stream job logs
glab ci retry <job-id>                             # Retry a failed job
```

`glab ci view` needs a TTY and fails here. Use `glab ci get` for pipeline and job detail.

Keyword syntax is at <https://docs.gitlab.com/ci/yaml/> and predefined variables at <https://docs.gitlab.com/ci/variables/>.
