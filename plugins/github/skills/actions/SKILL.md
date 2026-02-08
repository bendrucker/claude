---
name: github:actions
description: >-
  GitHub Actions CI/CD workflow development and run monitoring. Use when creating
  or editing .github/workflows YAML files, configuring triggers, jobs, matrix strategies,
  caching, or artifacts. Also covers gh CLI for monitoring runs, viewing logs, and debugging failures.
user-invocable: true
---

# GitHub Actions

## Workflow Style

Separate jobs with a double blank line. Annotate non-obvious configuration with inline comments. Omit boilerplate that's clear from context.

### Example

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# Cancel redundant runs on the same branch
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint


  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun test --shard ${{ matrix.shard }}/3


  deploy:
    needs: [lint, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production  # requires approval in repo settings
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
```

### Key Patterns

- **`concurrency`** at workflow level cancels stale runs on the same branch
- **`permissions`** — always set explicitly, least privilege
- **`fail-fast: false`** — let all matrix jobs finish so you see all failures
- **`needs`** — express job dependencies; jobs without `needs` run in parallel
- **`if`** on jobs — gate deployment on branch, skip expensive work on draft PRs

See [references/workflows.md](references/workflows.md) for triggers, caching, artifacts, services, reusable workflows, and outputs.

## Monitoring Runs

### Quick Reference

```bash
gh run list --branch $(git branch --show-current) --limit 5  # check CI
gh run watch <run-id>                                         # wait for completion
gh run view <run-id> --log-failed                             # debug failures
```

### Automated Monitoring

The `actions-monitor` agent automates failure monitoring and log extraction.

See [references/cli.md](references/cli.md) for the full command reference.
