---
type: regex
pattern: '"@union/web/yaml"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
The two yaml versions coexist as a nested web entry.
