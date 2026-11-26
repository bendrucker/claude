---
type: regex
pattern: 'process\.env\.PORT'
match: contains
target: { source: file, path: .eval-pushed-tree/src/server.ts }
---
The branch's PORT lookup survives.
