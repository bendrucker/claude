---
type: regex
pattern: 'Math\.max\(options\.timeout, 0\)'
match: contains
target: { source: file, path: .eval-pushed-tree/src/wait.ts }
---
The branch's clamp survives.
