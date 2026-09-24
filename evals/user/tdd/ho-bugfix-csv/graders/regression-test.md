---
type: regex
target:
  source: file
  path: src/csv.test.ts
pattern: 'b,c'
match: contains
---
A test reproduces the reported input with its quoted comma.
