---
type: regex
pattern: 'timeout: 30\b[^_0-9]'
match: not_contains
target: { source: file, path: .eval-pushed-tree/src/drain.ts }
---
The fifth caller does not keep a bare `30`.
