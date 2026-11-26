---
type: regex
pattern: '"yaml@2.7.1"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
The branch's locked yaml 2.7.1 survives.
