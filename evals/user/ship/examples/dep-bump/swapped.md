---
fail: [not-in-review-human, not-in-review-code, not-in-simplify, not-in-pull-request-follow-up, not-in-run, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: review:code → simplify → pull-request:follow-up → run → comments:audit → review:human, then create and babysit.
- in: review:code high, simplify, pull-request:follow-up, run, comments:audit, review:human
- out: writing:review
</out>

Stopping here as asked.
