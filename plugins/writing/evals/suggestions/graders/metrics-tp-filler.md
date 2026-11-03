---
type: regex
target: { source: file, path: docs/metrics.rst }
pattern: 'important to note'
flags: i
match: not_contains
---
The filler opener a suggestion flagged is cut.
