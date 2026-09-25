---
fail: [in-writing-review, in-review-human, not-in-review-code, not-in-simplify, not-in-run, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: review:code → simplify → run → comments:audit, then create and babysit.
in: review:code medium --fix, simplify, run, comments:audit.
out: writing:review, review:human.
</out>

Stopping here as asked.
