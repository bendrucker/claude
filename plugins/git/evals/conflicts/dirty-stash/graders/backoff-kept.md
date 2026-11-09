---
type: regex
pattern: '2 \*\* i'
match: contains
target: { source: file, path: .eval-pushed-tree/src/retry.ts }
---
main's exponential backoff survives.
