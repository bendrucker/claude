# CLI Reference

## Workflow Runs

| Command | Description |
|---------|-------------|
| `gh run list` | List recent workflow runs |
| `gh run list --workflow <name>` | Filter by workflow name |
| `gh run list --branch <branch>` | Filter by branch |
| `gh run list --status <status>` | Filter by status (completed, in_progress, queued) |
| `gh run view <run-id>` | View run summary and job status |
| `gh run view <run-id> --log` | View all logs |
| `gh run view <run-id> --log-failed` | View logs for failed jobs only |
| `gh run watch <run-id>` | Watch run in real-time until completion |
| `gh run rerun <run-id>` | Re-run all jobs |
| `gh run rerun <run-id> --failed` | Re-run failed jobs only |
| `gh run cancel <run-id>` | Cancel a running workflow |

## Workflow Management

| Command | Description |
|---------|-------------|
| `gh workflow list` | List all workflows |
| `gh workflow view <name>` | View workflow details |
| `gh workflow run <name>` | Trigger a workflow manually |
| `gh workflow enable <name>` | Enable a disabled workflow |
| `gh workflow disable <name>` | Disable a workflow |

## Common Patterns

### Monitor CI After Push

```bash
git push
run_id=$(gh run list --branch $(git branch --show-current) --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$run_id"
```

### View Logs for Most Recent Failed Run

```bash
run_id=$(gh run list --status failure --limit 1 --json databaseId -q '.[0].databaseId')
gh run view "$run_id" --log-failed
```

### Finding Flaky Tests

```bash
gh run view <run-id> --log-failed | grep -A 10 "FAIL"
```

## Tips

- Run IDs appear in `gh run list` output and in GitHub URLs
- Use `--json` with `--jq` for programmatic access: `gh run list --json databaseId,status,conclusion`
- Workflow names match the `name:` field in `.github/workflows/*.yml` files
