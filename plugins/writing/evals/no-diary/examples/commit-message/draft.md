---
fail: [keeps-rate-limit, no-hedge]
---
<rewrite>
Add a retry helper for flaky upstream calls, capped at 3 attempts. This should resolve the intermittent 429s in the nightly job.
</rewrite>
