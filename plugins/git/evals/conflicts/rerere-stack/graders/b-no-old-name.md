---
type: regex
pattern: '^\s*timeoutMs:'
flags: m
match: not_contains
target: { source: file, path: .eval-pushed-trees/read-timeout/src/limits.ts }
---
The second branch leaves no old name.
