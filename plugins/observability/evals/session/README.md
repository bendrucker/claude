# Session Skill Eval

Asks the session skill questions about a frozen copy of the real index and scores the answers against reference SQL. It is the value-to-agents half of the session index's measurement setup. The [bench](../bench/) is the performance half.

## Metrics

| Column | Source |
|---|---|
| recall | share of the truth rows some reply line states, key and value together |
| precision | share of the reply's answer lines (list items, table rows) that state a truth row; equals recall for a single number |
| tokens | input, cache, and output tokens from the trace's final usage |
| seconds | the session's duration |
| queries | statements the session sent to `duckdb`, parsed from its Bash calls by the bench's `sql.ts` |
| errors | `duckdb` calls that failed or printed a DuckDB error class, which the CLI can do on exit 0 |
| reference | whether the session read or ran the file the case's `-- reference:` header names |

## Cases

Each case directory holds `case.yaml`, `prompt.md`, a `fixture.sh` that runs [`index.sh`](index.sh), and `truth.sql`. `index.sh` copies `data/session.duckdb` to the skill's default path under the run's temporary home and stamps it fresh, so `refresh.ts` never rescans it.

`truth.sql` runs after [`prelude.sql`](prelude.sql) and reads `raw` alone, so ground truth never passes through the views under test. It returns rows of `key` and `value`, either of which may be absent. A `-- tolerance: 0.05` header lets a value match within 5%, and `-- reference: <regex>` sets the reference check. Truth runs at scoring time against the same frozen index the sessions read, so no expected number is written down anywhere.

The `drift-*` cases ask questions whose answer lives in a native harness field (permission decisions, attachment types, API error records) rather than in a heuristic the views apply. `scripts/truth.integration.ts` pins each one's truth query on a fixture transcript.

Tags split the cases into `dev` and `holdout`. Edit the skill against `dev` only, and run `holdout` to confirm a win. Cases mined from real sessions split by month: June to September is `dev`, October onward `holdout`. Mined prompts hold my session text, so they live in `s3://ben-drucker-agents-eval-corpus/session/` and never in the repo.

## Workflow

Freeze the index after a refresh, with no writer running. On APFS the copy is an instant clone:

```bash
bun plugins/observability/skills/session/scripts/refresh.ts --refresh
mkdir -p plugins/observability/evals/session/data
cp -c ~/.local/share/claude-sessions/session.duckdb plugins/observability/evals/session/data/
```

Run, then score:

```bash
bun evals/native/run.ts plugins/observability/evals/session -- --scaffold --ablation none --runs 3 --tag dev
bun plugins/observability/evals/session/scripts/score.ts plugins/observability/evals/session/results/<run>
```

`score.ts` prints the metrics per case and arm, and writes every run's numbers to `<run>/scored.json`. Before judging a candidate, run the unchanged skill at the same `--runs` and use the spread of those runs as the bar a change has to clear.

## Tests

```bash
bun test ./plugins/observability/evals/session/
bun test ./plugins/observability/evals/session/scripts/truth.integration.ts
```
