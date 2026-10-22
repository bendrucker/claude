Refine this into an issue:

The database agent's eval suite is saturated: six of seven dev cases score 1.00 on both arms. The one real gap is a question like "how many validation rules does the org have, and how many are active", where the agent pages through rows and reports "first 50 of 336, use offset pagination for the rest" instead of running a GROUP BY that answers in one row. Add aggregation cases to the suite so a climb has something to move, then climb the agent's prompt against them.

Notes:
- Traces in tmp/climb/noise-3/traces/ and tmp/climb/noise-4/traces/ show the same shape on every run: describe, then SELECT with limit=50, then a separate count query.
- Use the existing climb harness: `climb.py --ref <candidate> --base main --split dev --repeat 4`, compared with compare.ts from my hill-climb skill against a pooled baseline.
- Acceptance: the new aggregation cases improve with a starred row in compare.ts output over the pooled baseline.
- Candidate case shapes: count by a boolean column, count by a category with a long tail, sum over a date range, distinct count.

Files:
- agents/database/evals/scenarios/basic.yaml (the seven current cases)
- agents/database/prompt.md (the agent's system prompt)

Related:
- MR !412 — Add climb.py hill-climb harness for agent evals (open, in review, not merged) — https://tracker.example.com/mr/412
