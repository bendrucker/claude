---
type: regex
pattern: 'connectTimeoutMs: 1000'
match: contains
target: { source: file, path: .eval-pushed-trees/connect-timeout/src/limits.ts }
---
The first branch keeps its connect timeout.
