---
type: regex
target:
  source: file
  path: src/shipping.test.ts
pattern: 'toBe\(\s*\d[\d_]*\s*\)'
match: contains
---
At least one assertion compares against a literal number.
