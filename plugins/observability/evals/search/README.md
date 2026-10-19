# Session Search Eval

Scores `search.sql` as a ranker: each labeled query runs through an arm's `search.sql` in a fresh read-only `duckdb` process, and the sessions it returns are compared with the sessions a person would want. No agent runs, so it is cheap enough for every change to the query or its corpus. The `session/` suite's agent-level search cases reuse these labels through their query ids.

## Metrics

| Column | Meaning |
|---|---|
| P@5 | relevant sessions in the top 5, over 5 |
| recall@10 | relevant sessions in the top 10, over the relevant set (capped at 10) |
| MRR | mean of 1 / rank of the first relevant session |
| zero-hit | queries that returned nothing |
| wall p50, p90 | process start to exit, across every run |
| P@5 p | paired sign-flip permutation p against the first arm, over the same queries |

## Labels

`labels.jsonl` names private sessions, so it lives in the eval bucket and stays out of git. One row per query:

```json
{"id": "wedding-flight", "query": "wedding flight", "relevant": [{"host": "local", "session_id": "…"}], "tags": ["dev"]}
```

Seed queries with `mine.sql`, which lists the terms agents passed to `search.sql` and the ILIKE patterns they wrote against session prose by hand. Pool each query's candidates from the top 10 of every arm being compared, then judge each candidate. A session is relevant when it is one the asker was looking for, not when it merely mentions the term. Split the queries into `dev` and `holdout` tags, and climb on `dev` only.

```bash
bun sync.ts pull labels.jsonl
bun sync.ts push labels.jsonl
```

`sync.ts` takes `--prefix` so another harness can reuse it for its own files.

## Runs

`--index` defaults to the `session/` suite's frozen `data/session.duckdb`. Never point it at the live index. An arm is `name[=<skill dir>]`, defaulting to this checkout's skill, so a candidate worktree is scored on its own `search.sql`:

```bash
bun score.ts --labels labels.jsonl --tag dev --arm main --arm bm25=../wt/plugins/observability/skills/session --out results/bm25
```

An A/A run of the same skill twice records the latency noise floor. A ranking change ships only when its P@5 gain clears the permutation test.

## Tests

```bash
bun test ./plugins/observability/evals/search/
```
