---
fail: []
---
<rewrite>
## Loader drops rows

The LEFT JOIN fans out whenever `external_id` repeats. Loading `fixtures/dupes.csv`, where 3 rows share `external_id` `a1`, produces 9 output rows instead of 3.

Dedupe on `external_id` before the join.
</rewrite>

Cut:
- **Session leakage**: "Following up on our conversation earlier: per your suggestion", "Claude's analysis confirmed", "which matches what you saw on the dashboard"
- **Change evolution**: "reran the loader" framing, replaced with the direct finding

Kept the repro steps and fix as findings, and added the expected count (3) so the bug is self-evident without the surrounding narration.
