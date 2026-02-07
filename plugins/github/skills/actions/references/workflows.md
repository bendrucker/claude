# Workflow Development

## Triggers

```yaml
on:
  push:
    branches: [main]
    paths: ['src/**']              # only run when src changes
  pull_request:                    # all PRs, any branch
  workflow_dispatch:               # manual trigger from UI
    inputs:
      environment:
        type: choice
        options: [staging, production]
  schedule:
    - cron: '0 6 * * 1'           # weekly Monday 6am UTC
```

Use `paths-ignore` for exclusion-only patterns. For per-job path filtering, use `dorny/paths-filter`.

## Caching

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
    restore-keys: ${{ runner.os }}-bun-
```

Most setup actions (`actions/setup-node`, `oven-sh/setup-bun`) have built-in caching via a `cache` input — prefer that over manual `actions/cache` when available.

## Artifacts

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
    retention-days: 7
```

## Secrets

Pass secrets via `env`, never interpolate them directly in `run` commands:

```yaml
- run: ./deploy.sh
  env:
    API_KEY: ${{ secrets.API_KEY }}
```

Use `${{ vars.NAME }}` for non-sensitive configuration variables.

## Environments

```yaml
deploy:
  environment:
    name: production
    url: https://example.com
```

Configure required reviewers, wait timers, and branch restrictions in repo settings.

## Services

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_PASSWORD: test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

## Reusable Workflows

Caller:

```yaml
jobs:
  test:
    uses: ./.github/workflows/test.yml
    with:
      node-version: 22
    secrets: inherit
```

Callee declares `workflow_call` with typed inputs:

```yaml
on:
  workflow_call:
    inputs:
      node-version:
        type: number
        default: 22
```

## Outputs

Pass data between jobs via `$GITHUB_OUTPUT`:

```yaml
jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.tag.outputs.value }}
    steps:
      - id: tag
        run: echo "value=$(git describe --tags)" >> "$GITHUB_OUTPUT"


  deploy:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying ${{ needs.version.outputs.tag }}"
```
