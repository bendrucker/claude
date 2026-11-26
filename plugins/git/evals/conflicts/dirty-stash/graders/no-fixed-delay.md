---
type: regex
pattern: 'sleep\(options\.delayMs\)'
match: not_contains
target: { source: file, path: .eval-pushed-tree/src/retry.ts }
---
The delay is not left fixed.
