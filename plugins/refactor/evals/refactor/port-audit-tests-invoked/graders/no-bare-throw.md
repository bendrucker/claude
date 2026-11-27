---
type: regex
target: { source: file, path: test/duration.test.ts }
pattern: 'toThrow\(\)'
match: not_contains
---
Error assertions name the error type or message.
