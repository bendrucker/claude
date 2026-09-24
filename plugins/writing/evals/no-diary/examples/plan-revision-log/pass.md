---
fail: []
---
<rewrite>
# Migration Plan

## Approach

Backfill the new column in batches of 10k rows. Switch reads behind the `read_new_column` flag. After a week of clean reads, drop the old column.

## Rollback

Flip `read_new_column` off. The old column stays until the drop, so rollback is a flag change until then.
</rewrite>

Cut, by category:
- **Change evolution**: the mention of 50k batches timing out in an earlier draft.
- **Session leakage**: "which you caught" and "as you asked" — both narrate feedback from this conversation instead of just stating the current plan.
