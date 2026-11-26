---
type: regex
pattern: '^\s*timeoutMs:'
flags: m
match: not_contains
target: { source: file, path: .eval-pushed-trees/connect-timeout/src/limits.ts }
---
The first branch leaves no old name.
