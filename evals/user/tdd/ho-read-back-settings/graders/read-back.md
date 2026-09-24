---
type: regex
target:
  source: file
  path: src/settings.test.ts
pattern: '\.remove\([\s\S]*?\.get\('
match: contains
---
A test reads the key back with `get` after `remove`, verifying the deletion through the store's interface.
