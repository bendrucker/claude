# Plan Brief Eval

Mines planning sessions whose first presented plan the user redirected, for an A/B of the plan plugin's guidelines.

## Privacy

`data/` is gitignored and holds work-host session text. Its permanent copy lives in `s3://ben-drucker-agents-eval-corpus/plan-brief/` (the `agents` account). Never quote it in the repo, commits, or PR bodies.

## Workflow

`mine.ts` shells out to the `duckdb` CLI and reads the session index the `observability:session` skill maintains. Refresh that index first.

```bash
bun run --cwd plugins/plan/evals/brief sync pull   # bucket -> data/, --profile agents
bun run --cwd plugins/plan/evals/brief mine        # session index -> data/presents.json
bun run --cwd plugins/plan/evals/brief sync push   # data/ -> bucket, --profile agents-admin
```
