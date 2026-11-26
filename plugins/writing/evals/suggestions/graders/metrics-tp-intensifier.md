---
type: regex
target: { source: file, path: docs/metrics.rst }
pattern: 'very rarely'
flags: i
match: not_contains
---
The 'very' a suggestion flagged is cut.
