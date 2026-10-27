# Trivia evals

A pydantic-evals suite for a trivia assistant. `prompt.txt` is its system prompt. `cases.py` holds four cases, tagged `dev` or `holdout` in their `metadata`, and `evaluators.py` the custom evaluators.

Run every case twice per variant, once with `prompt.txt` as the system prompt (experiment `with`) and once without it (experiment `without`):

```bash
uv run --with pydantic-evals --with pydantic-ai python run_evals.py --out reports
```

Each variant writes its `EvaluationReport` as JSON to `reports/<experiment>.json`.
