---
type: regex
target:
  source: file
  path: src/csv.test.ts
pattern: 'splitFields'
match: not_contains
---
The tests reach the bug through `parseCsvLine`, not the private `splitFields`.
