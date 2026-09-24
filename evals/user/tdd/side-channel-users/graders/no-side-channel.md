---
type: regex
target:
  source: file
  path: src/users.test.ts
pattern: 'SELECT|\.(?:query|prepare|run)\('
match: not_contains
---
The tests never query the database directly.
