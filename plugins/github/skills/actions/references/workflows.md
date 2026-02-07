# Workflow Development

## Conditionals

```yaml
steps:
  - run: echo "deploying"
    if: github.ref == 'refs/heads/main'

  - run: echo "PR only"
    if: github.event_name == 'pull_request'

  - run: echo "previous step failed"
    if: failure()
```

Job-level conditionals:

```yaml
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    needs: [test, lint]
```

## Secrets and Variables

```yaml
env:
  NODE_ENV: production
steps:
  - run: echo "${{ secrets.API_KEY }}"
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
  - run: echo "${{ vars.ENVIRONMENT }}"
```

Never echo secrets directly — use them only in `env` blocks or action inputs.

## Environments

```yaml
jobs:
  deploy:
    environment:
      name: production
      url: https://example.com
    steps:
      - run: deploy.sh
```

Environments support required reviewers, wait timers, and deployment branch rules configured in repo settings.

## Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Cancels redundant runs when new commits push to the same branch.

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

Reusable workflow:

```yaml
on:
  workflow_call:
    inputs:
      node-version:
        type: number
        default: 22

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
```

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

Set at workflow or job level. Use least privilege — only grant what's needed.

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

## Path Filtering

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - '!src/**/*.test.ts'
```

Use `paths-ignore` for exclusion-only patterns. Combine with `dorny/paths-filter` action for per-job path filtering.

## Outputs

Pass data between jobs:

```yaml
jobs:
  build:
    outputs:
      version: ${{ steps.version.outputs.value }}
    steps:
      - id: version
        run: echo "value=1.2.3" >> "$GITHUB_OUTPUT"

  deploy:
    needs: build
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.version }}"
```
