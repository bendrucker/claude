---
name: github-actions
description: >-
  GitHub Actions CI/CD workflow development and run monitoring. Use when creating
  or editing .github/workflows YAML files, configuring triggers, jobs, matrix strategies,
  caching, or artifacts. Also covers gh CLI for monitoring runs, viewing logs, and debugging failures.
user-invocable: true
---

# GitHub Actions

## Developing Workflows

Workflow files live in `.github/workflows/*.yml`. Each workflow has triggers, jobs, and steps.

### Triggers

```yaml
on:
  push:
    branches: [main]
    paths: ['src/**']
  pull_request:
    branches: [main]
  workflow_dispatch:        # manual trigger
    inputs:
      environment:
        type: choice
        options: [staging, production]
  schedule:
    - cron: '0 6 * * 1'    # weekly Monday 6am UTC
```

### Jobs and Steps

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
```

### Matrix Strategy

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest]
    node: [20, 22]
    exclude:
      - os: macos-latest
        node: 20
```

### Caching

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
    restore-keys: ${{ runner.os }}-bun-
```

### Artifacts

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
    retention-days: 7
```

See [references/workflows.md](references/workflows.md) for conditionals, secrets, environments, reusable workflows, and concurrency.

## Monitoring Runs

Use `gh` CLI to check CI status, view logs, and debug failures. See the `gh` skill for general CLI usage.

See [references/cli.md](references/cli.md) for the full command reference and common patterns.

### Quick Reference

```bash
# Check CI on current branch
gh run list --branch $(git branch --show-current) --limit 5

# Watch a run until completion
gh run watch <run-id>

# View failed job logs
gh run view <run-id> --log-failed
```

The `actions-monitor` agent provides automated failure monitoring and log extraction.
