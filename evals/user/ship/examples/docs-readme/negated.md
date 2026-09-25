---
fail: []
---
The branch only edits `README.md`, so no code review applies.

<out>
Docs-only change: writing review, then Ben's review, then create.
**In:** `writing:review`, `review:human` (no `review:code` or `run`, since no code changed)
**Out:** `review:code`, `simplify`, `run`, `comments:audit`, `plan:review`, `pull-request:follow-up`, `github:copilot`
</out>
