---
fail: []
---
<rewrite>
## Export CSV drops the last row

This one bit me twice this week. The writer never flushes when the row count is an exact multiple of 500 (the batch size). Exports of 499 or 501 rows are fine, 500 or 1000 lose the final row.

Fix is probably a flush() after the loop.
</rewrite>

Cut the timezone and buffering detours.
