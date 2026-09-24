---
fail: [no-monologue]
---
<rewrite>
## Export CSV drops the last row

ok so this one bit me twice this week. I spent an afternoon convinced it was a timezone thing, then a buffering thing, before I figured it out: the writer never flushes when the row count is an exact multiple of 500 (the batch size). Exports of 499 or 501 rows are fine, 500 or 1000 lose the final row.

Fix is probably just a flush() after the loop, I'm pretty sure.
</rewrite>
