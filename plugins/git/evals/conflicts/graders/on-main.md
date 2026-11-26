---
type: regex
pattern: '^base: main$'
flags: m
match: contains
target: { source: file, path: .eval-verdicts }
---
The branch ends on top of main, not on its stale base.
