---
type: regex
pattern: '"yaml@2.8.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
main's locked yaml 2.8.0 survives instead of floating.
