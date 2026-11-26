---
type: regex
pattern: 'connectTimeoutMs: 1000'
match: contains
target: { source: file, path: .eval-pushed-trees/read-timeout/src/limits.ts }
---
The second branch keeps the first branch connect timeout.
