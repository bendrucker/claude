---
name: gitlab:ci
description: Authoring and validating GitLab CI configuration. Use when editing `.gitlab-ci.yml`, structuring pipeline stages and jobs, or running `glab ci lint`. For pipeline/job failure investigation, use gitlab:ci-monitor.
---
# GitLab CI/CD

Working with GitLab CI/CD pipelines and jobs via `glab ci`.

## Key Commands

```bash
glab ci status             # Pipeline status for current branch
glab ci list               # List recent pipelines
glab ci lint               # Validate .gitlab-ci.yml
glab ci trace <job-id>     # Watch job logs in real-time
glab ci retry <job-id>     # Retry a failed job
glab ci run                # Trigger pipeline for current branch
```

Use `glab ci --help` and `glab ci <command> --help` for full options.

## Debugging Failures

- `glab ci view` - Interactive view of pipeline jobs (trace/retry from here too)
- `glab ci trace <job-id>` - Stream job logs in real-time
- `glab ci retry <job-id>` - Retry a failed job

## Configuration

For `.gitlab-ci.yml` syntax, see `/ci/yaml/` in [GitLab docs](https://docs.gitlab.com/ci/yaml/).
