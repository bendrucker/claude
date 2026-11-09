---
type: regex
pattern: '"commander@14.0.2"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
main's locked commander 14.0.2 survives.
