---
fail: [in-simplify, in-review-human, not-in-review-code, not-in-comments-audit, not-in-writing-review]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: code-review → comments:audit → writing:review, then create and babysit.
in: code-review medium, comments:audit, writing:review
out: simplify, review:human
</out>

Stopping here as asked.
