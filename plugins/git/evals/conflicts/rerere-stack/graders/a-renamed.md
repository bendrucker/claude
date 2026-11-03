---
type: regex
pattern: 'requestTimeoutMs: 5000'
match: contains
target: { source: file, path: .eval-pushed-trees/connect-timeout/src/limits.ts }
---
The first branch takes the rename.
