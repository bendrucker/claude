---
type: regex
pattern: 'requestTimeoutMs: 5000'
match: contains
target: { source: file, path: .eval-pushed-trees/read-timeout/src/limits.ts }
---
The second branch takes the rename.
