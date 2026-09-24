---
fail: [no-session]
---
<rewrite>
## Loader drops rows

Following up on our conversation earlier: per your suggestion I reran the loader against the staging snapshot, and Claude's analysis confirmed the LEFT JOIN fans out whenever `external_id` repeats, which matches what you saw on the dashboard. To reproduce, load `fixtures/dupes.csv`, where 3 rows share `external_id` `a1`: the output has 9.

Dedupe on `external_id` before the join.
</rewrite>
