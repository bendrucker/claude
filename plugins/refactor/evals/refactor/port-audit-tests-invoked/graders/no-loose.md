---
type: regex
target: { source: file, path: test/duration.test.ts }
pattern: 'toBeDefined\(\)|toBeTruthy\(\)|toContain\(["''`]1h["''`]\)'
match: not_contains
---
Exact-value assertions are not loosened to presence or substring checks.
