# Evals

This directory is the generic layer: the native suite runner and the report that prices runs from any suite. Per-skill harnesses live with the plugin they measure, at `plugins/<plugin>/evals/<suite>/`, each with its own README: [`pr-body`](../plugins/pull-request/evals/pr-body/), [`issue-refine`](../plugins/issue/evals/issue-refine/), [`review-voice`](../plugins/review/evals/review-voice/), [`comment-density`](../plugins/comments/evals/comment-density/).

[`scripts/`](scripts/) is shared across them. It reports what native runs cost and how they scored.

## Native Suites

[`native/`](native/) runs and compares `claude plugin eval` suites. The [plugin evals docs](https://code.claude.com/docs/en/plugin-evals.md) define the `case.yaml` and grader schemas.

- `run.ts <suite> [--ref <ref>] -- <args>` stages the plugins the cases load, as they stand at `--ref` (the working tree by default), next to the suite from the working tree, so every ref is graded by the same cases. `--case` may repeat, and takes any `Bun.Glob` pattern: `run.ts` prunes the staged suite to the cases any glob matches, since the runner keeps only the last `--case` and matches plain `*` only. It runs on subscription auth with any API key removed from the environment, and results land in `<suite>/results/<timestamp>[-label]/`, with each run's trace copied to `traces/<case>-<arm>-<n>.jsonl`.
- `compare.ts <column>...` compares result files column by column, each column a comma-joined pool of `aggregate-result.json` paths, the first the baseline. A `*` marks p < `--alpha` (0.1) under a two-sided permutation test. A `†` marks a cell with too few runs for any star: at 0.1 that takes 4 runs a side, since 3 against 3 bottoms out at exactly 0.1. A run that errored, from its `error` field or a judge call that threw, leaves the pool, and `!` marks its case. `run.ts` exits 1 when any run errored, which fails the eval job. `--suite` adds per-tag scores from each case's `tags`. `--markdown` puts starred rows first for a job summary.
- `check.ts <suite>` tests each case's `regex` graders against examples in `<suite>/examples/<case>/`, outside the case directories so no session sees them. A `.md` example is a hand-written reply whose frontmatter `fail:` lists the graders it must fail. A `.jsonl` example is a trace, such as one copied from a run's `traces/`, with `fail:` in a sibling `.yaml`. It grades trace graders on the raw JSONL, as the runner does, and reply graders on its last `result` line. A directory named after an example holds the files its file-target graders read, such as `examples/<case>/good/src/a.ts` beside `good.md`. Every other grader an example reaches must pass it, and the output names regex graders no example reaches, such as file targets.
- `regrade.ts <suite> <results>...` re-scores stored runs against the suite's current grader set from their `traces/`, dropping graders whose file is gone and grading regex graders added since the run, and writes `<results>-regraded/` for `compare.ts`, so a grader fix needs no new sessions. `llm` and file-target graders keep their recorded verdicts.
- `calls.ts <results>... [--match <regex>]` takes results directories or their `aggregate-result.json` paths, and counts the runs per case and arm that read each file or loaded each skill, from `traces/`. It answers whether sessions opened a reference, which grepping traces for the filename cannot, since injected skill text names files too.
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

Each native suite keeps its runs in its own `results/` directory: `plugins/<plugin>/evals/<suite>/results/<run>/` for plugin suites and `evals/user/<suite>/results/<run>/` for the rest. `run.ts` writes the runner's `aggregate-result.json` there, with the traces beside it. `results/` is git-ignored in every suite, since traces carry whatever the session touched, including work-repo content, which never lands in this public repo.

## Scripts

### `report.ts`

Rolls up every run's `aggregate-result.json` per suite: run count, partial runs, the last run's date, score, and cost, the last 30 days of cost and session time, and a monthly projection against the $20 budget. A `-regraded` directory from `regrade.ts` repeats its source run's cost, so the report leaves it out.

```bash
bun evals/scripts/report.ts
bun evals/scripts/report.ts --budget 40 --json
bun evals/scripts/report.ts --sql "SELECT suite, run, cost_usd, overall_score FROM runs ORDER BY started_at DESC"
bun evals/scripts/report.ts --sql "SELECT \"case\", avg(score) FROM cases WHERE suite = 'writing/rewrite' GROUP BY 1"
```

The projection scales the last 30 days of spend over the window actually observed, with a seven-day floor so one fresh run cannot project as a month of the same spending.

`--sql` runs any query against two views. `runs` has one row per result, with `suite` (`<plugin>/<suite>` or `user/<suite>`), `run`, `started_at`, `cost_usd`, `duration_seconds`, `partial`, `cases_total`, `cases_passed`, `overall_score`, `mean_delta`, and `path`. `cases` has one row per case in each result, with `suite`, `run`, `started_at`, `case`, `score`, `score_without`, and `delta`. `--root` reads another checkout. It needs the `duckdb` CLI on `PATH` (`brew install duckdb`), as does the default rollup.

### Billing Source

`costUsd` in a result is the runner's list-price total for the run's sessions and judge calls. `run.ts` removes `ANTHROPIC_API_KEY` from the environment, so local runs spend the Claude Code login's subscription credits and CI spends the `CLAUDE_CODE_OAUTH_TOKEN` secret's. The budget is a spending signal at list price, and a run over it bills nothing extra.

## Tests

```bash
bun test evals/scripts
```

The fixtures under [`scripts/test/corpus/`](scripts/test/corpus/) are a hand-authored repo tree of `aggregate-result.json` files, tracked so the file discovery and the rollup stay pinned. The report test needs the `duckdb` CLI.
