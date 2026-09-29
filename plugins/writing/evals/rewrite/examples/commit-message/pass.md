---
fail: []
---
<rewrite>
Add a retry helper for flaky upstream calls

Cap retries at 3, since the API rate-limits us after that. Fixes the intermittent 429s in the nightly job.
</rewrite>
