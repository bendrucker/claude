---
type: regex
target: { source: file, path: test/duration.test.ts }
pattern: '\.(skip|todo)\('
match: not_contains
---
No test is skipped.
