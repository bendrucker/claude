---
fail: [in-review-code, in-pull-request-follow-up, in-review-human, not-in-simplify, not-in-writing-review, not-in-comments-audit, review-code-high]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: simplify → writing:review → comments:audit, then create and babysit.
- in: simplify, writing:review, comments:audit
- out: review:code, pull-request:follow-up, review:human
</out>

Stopping here as asked.
