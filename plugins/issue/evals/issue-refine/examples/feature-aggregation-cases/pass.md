---
fail: []
---
<issue>
---
title: Add aggregation cases to the database agent evals
type: feature
relations:
  blocked-by:
    - https://tracker.example.com/mr/412
---

Six of seven dev cases score 1.00 on both arms, so the suite can't tell prompts apart. The gap is aggregate questions: asked how many validation rules are active, the agent pages through 50 rows instead of running a `GROUP BY`. Add cases that count by a boolean, count over a long-tail category, sum over a date range, and count distinct values, then climb the prompt against them once the climb harness from [MR !412](https://tracker.example.com/mr/412) merges.

## 🤖 Agent Context

- `agents/database/evals/scenarios/basic.yaml` holds the current cases
- `agents/database/prompt.md` is the climb target
</issue>
