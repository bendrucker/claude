# Evals

This directory is the generic layer: the results corpus and the scripts that file and price runs from any suite. Per-skill harnesses live with the plugin they measure, at `plugins/<plugin>/evals/<suite>/`, each with its own README: [`pr-body`](../plugins/pull-request/evals/pr-body/), [`issue-refine`](../plugins/issue/evals/issue-refine/), [`review-voice`](../plugins/review/evals/review-voice/), [`writing`](../plugins/writing/evals/writing/), [`comment-density`](../plugins/comments/evals/comment-density/).

[`scripts/`](scripts/) is shared across them. It moves promptfoo runs out of promptfoo's SQLite database into a durable corpus and reports what the runs cost.

## Results Corpus

promptfoo keeps its own database under `~/.cache/promptfoo`, set through `PROMPTFOO_CONFIG_DIR` because the default `~/.promptfoo` is not writable under the repo sandbox. That database is the browse layer. It is machine-local, so the canonical durable record is one `promptfoo export` JSON per run under `evals/results/<suite>/<date>-<id>.json`, mirrored to `s3://ben-drucker-agents-eval-corpus/eval-results/`.

`evals/results/` is git-ignored. Exports carry whatever the run touched, including work-repo content, which never lands in this public repo.

## Scripts

### `export-run.ts`

Exports one eval and files it in the corpus.

```bash
bun evals/scripts/export-run.ts --suite pr-body           # the latest run
bun evals/scripts/export-run.ts eval-abc-2026-08-28T09:00:00 --suite pr-body
bun evals/scripts/export-run.ts --suite pr-body --sync    # then mirror to S3
```

Without `--suite` the suite comes from a slug of the config description. The date in the filename comes from the run's own timestamp, so re-exporting an old run files it under the day it ran. Pass `--date YYYY-MM-DD` for a payload that carries no timestamp.

`--sync` uses the standard AWS credential chain. It prints a notice and leaves the export on disk when no credentials resolve, and again when the credentials that do resolve cannot reach the bucket, so neither an unauthenticated shell nor one signed into the wrong role loses the export.

### `collect-ci-runs.ts`

Pulls the exports that the eval workflow uploaded as artifacts, imports each into the local promptfoo database, and files a copy in the corpus.

```bash
bun evals/scripts/collect-ci-runs.ts --limit 5 --suite pr-body
bun evals/scripts/collect-ci-runs.ts 12345678 --suite pr-body   # one run
```

Defaults to the last five successful `eval.yml` runs. `--conclusion any` collects failures too, `--repo OWNER/REPO` reads another checkout's workflow.

### `report.ts`

Rolls the corpus up per suite: run count, last run and its cost, the last 30 days split by who pays for it, and a monthly projection against the $20 budget.

```bash
bun evals/scripts/report.ts
bun evals/scripts/report.ts --budget 40 --json
bun evals/scripts/report.ts --sql "SELECT suite, eval_id, billing, cost_usd FROM runs ORDER BY created_at DESC"
```

The projection scales the last 30 days of spend over the window actually observed, with a seven-day floor so one fresh run cannot project as a month of the same spending.

`--sql` runs any query against the `runs` view, one row per export, with `suite`, `eval_id`, `created_at`, `billing`, `cost_usd`, `api_usd`, `subscription_usd`, `passes`, `failures`, and `path`. It needs the `duckdb` CLI on `PATH` (`brew install duckdb`), as does the default rollup.

### Billing Source

Only the `30d API` column counts against the budget. Local runs authenticate through the Claude Code login and CI through the `CLAUDE_CODE_OAUTH_TOKEN` secret, so both spend subscription credits, and charging their list price to a $20 API budget produces alarms for money nobody was billed.

A promptfoo export prices the arms under `results.prompts[].metrics.cost` and records nothing about how the run authenticated, so the view bills every run to the subscription unless its payload carries `metadata.billing: "api"`. Nothing writes that stamp automatically: hand-edit it into the exported JSON of any run deliberately keyed with an API key so the report counts it.

## Tests

```bash
bun test evals/scripts
```

The fixtures under [`scripts/test/`](scripts/test/) are hand-authored export payloads, tracked so the rollup and the file naming stay pinned. The report test needs the `duckdb` CLI.
