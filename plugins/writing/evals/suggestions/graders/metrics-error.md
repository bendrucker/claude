---
type: regex
target: { source: file, path: docs/metrics.rst }
pattern: 'nightly;'
match: not_contains
---
The semicolon splice the error flagged is split.
