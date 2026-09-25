---
fail: [in-review-human, not-in-run, not-in-writing-review, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: run → writing:review → comments:audit, then create and babysit.
in: run, writing:review, comments:audit
out: review:human
</out>

Stopping here as asked.
