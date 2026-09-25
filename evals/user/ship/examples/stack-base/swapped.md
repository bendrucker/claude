---
fail: [in-review-code, in-review-human, not-in-writing-review, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: writing:review → comments:audit, then create and babysit.
- in: writing:review, comments:audit
- out: review:code, review:human
</out>

Stopping here as asked.
