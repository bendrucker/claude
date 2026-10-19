---
fail: [in-writing-review, in-review-human, not-in-review-code, not-in-simplify, not-in-run, not-in-comments-audit]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: code-review → simplify → run → comments:audit, then create and babysit.
**in:** `code-review (low)`, `simplify`, `run`, `comments:audit`
**out:** `writing:review`, `review:human`
</out>

Stopping here as asked.
