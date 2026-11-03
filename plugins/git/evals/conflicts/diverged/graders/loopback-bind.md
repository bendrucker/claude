---
type: regex
pattern: '127\.0\.0\.1'
match: contains
target: { source: file, path: .eval-pushed-tree/src/server.ts }
---
origin's loopback bind survives.
