---
type: regex
pattern: 'options\.shouldRetry\(error\)'
match: contains
target: { source: file, path: .eval-pushed-tree/src/retry.ts }
---
The branch's fatal-error guard survives.
