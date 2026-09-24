no-diary the plan

---
# Migration Plan

## Approach

Backfill the new column in batches of 10k rows (the 50k batches from the first draft timed out, which you caught). Switch reads behind the `read_new_column` flag. After a week of clean reads, drop the old column. I've taken out the shadow-write phase as you asked.

## Rollback

Flip `read_new_column` off. The old column stays until the drop, so rollback is a flag change until then.
---
