---
type: regex
pattern: 'readTimeoutMs: 2000'
match: contains
target: { source: file, path: .eval-pushed-trees/read-timeout/src/limits.ts }
---
The second branch keeps its read timeout.
