# Evals

This directory is the generic layer: the results corpus and the scripts that file and price runs from any suite. Per-skill harnesses live with the plugin they measure, at `plugins/<plugin>/evals/<suite>/`, each with its own README: [`pr-body`](../plugins/pull-request/evals/pr-body/), [`issue-refine`](../plugins/issue/evals/issue-refine/), [`review-voice`](../plugins/review/evals/review-voice/), [`writing`](../plugins/writing/evals/writing/), [`comment-density`](../plugins/comments/evals/comment-density/).

[`scripts/`](scripts/) is shared across them. It moves promptfoo runs out of promptfoo's SQLite database into a durable corpus and reports what the runs cost.

## Native Suites

[`native/`](native/) runs and compares `claude plugin eval` suites. The [plugin evals docs](https://code.claude.com/docs/en/plugin-evals.md) define the `case.yaml` and grader schemas.

- `run.ts <suite> [--ref <ref>] -- <args>` stages the plugins the cases load, as they stand at `--ref` (the working tree by default), next to the suite from the working tree, so every ref is graded by the same cases. It runs on subscription auth with any API key removed from the environment, and results land in `<suite>/results/<timestamp>[-label]/`, with each run's trace copied to `traces/<case>-<arm>-<n>.jsonl`.
- `compare.ts <column>...` compares result files column by column, each column a comma-joined pool of `aggregate-result.json` paths, the first the baseline. A `*` marks p < `--alpha` (0.1) under a two-sided permutation test. A `†` marks a cell with too few runs for any star: at 0.1 that takes 4 runs a side, since 3 against 3 bottoms out at exactly 0.1. `--suite` adds per-tag scores from each case's `tags`. `--markdown` puts starred rows first for a job summary.
- `check.ts <suite>` tests each case's `regex` graders against examples in `<suite>/examples/<case>/`, outside the case directories so no session sees them. A `.md` example is a hand-written reply whose frontmatter `fail:` lists the graders it must fail. A `.jsonl` example is a trace, such as one copied from a run's `traces/`, with `fail:` in a sibling `.yaml`. It grades trace graders on the raw JSONL, as the runner does, and reply graders on its last `result` line. A directory named after an example holds the files its file-target graders read, such as `examples/<case>/good/src/a.ts` beside `good.md`. Every other grader an example reaches must pass it, and the output names regex graders no example reaches, such as file targets.
- `regrade.ts <suite> <results>...` re-scores stored runs against the suite's current grader set from their `traces/`, dropping graders whose file is gone and grading regex graders added since the run, and writes `<results>-regraded/` for `compare.ts`, so a grader fix needs no new sessions. `llm` and file-target graders keep their recorded verdicts.
- `calls.ts <results>... [--match <regex>]` counts the runs per case and arm that read each file or loaded each skill, from `traces/`. It answers whether sessions opened a reference, which grepping traces for the filename cannot, since injected skill text names files too.
- `wrap.ts` builds a throwaway plugin from skills, agents, and context documents that are not in a plugin. A suite opts in through `suite.yaml`:

```yaml
allow_tools: ["Bash(git:*)"]    # gated tools passed to --allow-tools
judge_model: claude-sonnet-5
wrap:                           # omit when the cases load a plugin
  skills: [user/skills/tdd]
  context: [user/rules/typescript.md]
```

The runner ignores a `CLAUDE.md` or `.claude/rules` in the scaffolded working directory, so wrapped context reaches the session through a `SessionStart` hook instead. It injects every context file whatever its `paths:` frontmatter says. A wrapped skill keeps the files it links to beside it, such as a sibling skill's reference, and loses `disable-model-invocation`, so a user-invoked skill can load from a natural-language prompt on the with arm.

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
