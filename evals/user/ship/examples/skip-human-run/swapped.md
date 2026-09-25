---
fail: [in-review-code, not-in-review-human, not-in-run, not-in-writing-review]
---
Diffed the branch against its base and gated the passes.

<out>
Plan: review:human → run → writing:review, then create and babysit.
**in:** `review:human`, `run`, `writing:review`
**out:** `review:code`
</out>

Stopping here as asked.
