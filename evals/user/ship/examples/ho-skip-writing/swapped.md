---
fail: [in-review-human, not-in-writing-review, not-in-review-code, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: writing:review → code-review → comments:audit, then create and babysit.
in: writing:review, code-review medium --fix, comments:audit.
out: review:human.
</out>

Stopping here as asked.
