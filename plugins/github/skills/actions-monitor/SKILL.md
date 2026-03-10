---
name: github:actions-monitor
description: |
  Monitor GitHub Actions workflow runs and extract failure diagnostics. Use when watching CI after a push, checking workflow status, or investigating failed runs. Identifies failing jobs, extracts relevant error output, and returns a concise summary.
context: fork
agent: general-purpose
model: haiku
allowed-tools: [Bash(gh run:*)]
---

# Actions Monitor

Monitor GitHub Actions and extract failure diagnostics. Extract only: find the failures and present them concisely. Do not analyze root causes or suggest fixes.

## Target

$ARGUMENTS

If no run ID or PR is specified, use the current branch.

## Current Branch

!`git branch --show-current`

## Workflow

### List recent runs

Fetch recent runs for the current branch:

```bash
gh run list --branch <current-branch> --limit 5 --json databaseId,status,conclusion,displayTitle,workflowName
```

### Identify the run

From the recent runs, identify the most relevant run (latest, or matching the target). If the run is still in progress, use `gh run watch <id>` to wait for completion.

### Enumerate failing jobs

```bash
gh run view <run-id> --json jobs --jq '[.jobs[] | select(.conclusion == "failure") | {name, databaseId, conclusion}]'
```

### Extract per-job logs

For each failing job, fetch its log:

```bash
gh run view --log --job <job-id>
```

Parse the log output for failure-relevant sections. See [references/log-parsing.md](references/log-parsing.md) for CI-specific log structure.

If the full job log is still too large, try `--log-failed` on the specific job:

```bash
gh run view --log-failed --job <job-id>
```

When multiple jobs fail, fetch logs for each job in separate parallel Bash calls.

### Report

For each failed job, report:
- Job name and step that failed
- The relevant error snippet (10-50 lines)
- Any test names, file:line references, or error codes

Keep the total output concise. The parent conversation will use this to investigate.
