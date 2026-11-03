---
type: regex
pattern: 'listen\(3000'
match: not_contains
target: { source: file, path: .eval-pushed-tree/src/server.ts }
---
The port is not left fixed.
