# CI/CD Pipelines

Working with GitLab CI/CD pipelines and jobs via `glab ci`.

## Command Reference: gh run → glab ci

| GitHub (`gh run`) | GitLab (`glab ci`) | Notes |
|-------------------|-------------------|-------|
| `gh run list` | `glab ci list` | List pipelines |
| `gh run view <id>` | `glab ci view` | View pipeline details |
| `gh run watch` | `glab ci trace <job-id>` | Watch job logs in real-time |
| N/A | `glab ci lint` | Validate `.gitlab-ci.yml` |
| N/A | `glab ci status` | View pipeline status for current branch |

## Viewing Pipelines

```bash
# List recent pipelines
glab ci list

# Pipeline status for current branch
glab ci status

# View specific pipeline
glab ci view

# Get pipeline JSON
glab ci get --output json
```

## Working with Jobs

```bash
# Watch job logs in real-time
glab ci trace <job-id>

# Retry a failed job
glab ci retry <job-id>

# Trigger manual job
glab ci trigger <job-id>

# Cancel job
glab ci cancel job <job-id>

# Cancel entire pipeline
glab ci cancel <pipeline-id>
```

## Validating Configuration

```bash
# Lint .gitlab-ci.yml file
glab ci lint

# Lint specific file
glab ci lint --path custom-ci.yml
```

## Running Pipelines

```bash
# Run pipeline for current branch
glab ci run

# Run pipeline with variables
glab ci run --variables KEY1=value1,KEY2=value2
```

## Best Practices

- **Validate locally**: Run `glab ci lint` before pushing
- **Check status**: Use `glab ci status` before merging MRs
- **Watch logs**: Use `glab ci trace` for real-time debugging
- **Use job names**: More reliable than job IDs for retries
