---
name: gitlab:ci-monitor
description: |
  Investigate GitLab CI pipeline failures and extract diagnostic information. Use when checking pipeline status, debugging failed jobs, or monitoring CI after a push. Identifies failing jobs, extracts relevant error output, and returns a concise summary.
context: fork
agent: general-purpose
model: haiku
allowed-tools:
  - Bash(glab ci:*)
  - Bash(glab api:*)
---

# CI Monitor

Investigate GitLab CI pipeline failures and extract diagnostic information. Extract only: find the failures and present them concisely. Do not analyze root causes or suggest fixes.

## Target

$ARGUMENTS

If no pipeline ID or MR is specified, use the current branch.

## Current Pipeline

!`glab ci status 2>/dev/null || echo "no pipeline"`

## Workflow

### Identify the pipeline

From the pipeline status above, identify the relevant pipeline. If still running, use `glab ci status --wait` to wait for completion.

### Report source SHA

Query the MR to get the source branch SHA: `glab api projects/:id/merge_requests/:iid` and read the `sha` field. Report this as "Source SHA" in the output. The `sha` field reflects the branch tip, not the pipeline SHA (which may be a synthetic merge commit from `refs/merge-requests/N/merge`).

### Enumerate failing jobs

```bash
glab ci get --output json | jq '[.jobs[] | select(.status == "failed") | {name, id, stage, status}]'
```

If `glab ci get` is unavailable, use `glab ci list` to find the pipeline ID and `glab api projects/:id/pipelines/<pipeline-id>/jobs` for job details.

### Extract per-job logs

For each failing job, fetch its log:

```bash
glab ci trace <job-id>
```

Parse the log output for failure-relevant sections. See [references/log-parsing.md](references/log-parsing.md) for CI-specific log structure.

When multiple jobs fail, fetch logs for each job in separate parallel Bash calls.

### Report

For each failed job, report:
- Job name, stage, and the step that failed
- The relevant error snippet (10-50 lines)
- Any test names, file:line references, or error codes

Keep the total output concise. The parent conversation will use this to investigate.
