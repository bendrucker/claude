---
type: regex
target:
  source: file
  path: src/users.test.ts
pattern: 'getUser\('
match: contains
---
The tests verify the stored name by reading it back through `getUser`.
