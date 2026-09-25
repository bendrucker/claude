---
fail: [in-review-code, in-review-human, not-in-simplify, not-in-comments-audit, not-in-writing-review]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: simplify → comments:audit → writing:review, then create and babysit.
- in: simplify, comments:audit, writing:review
- out: review:code, review:human
</out>

Stopping here as asked.
