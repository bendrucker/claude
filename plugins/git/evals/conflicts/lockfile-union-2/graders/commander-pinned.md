---
type: regex
pattern: '"commander@14.0.2"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
commander stays at the locked 14.0.2.
