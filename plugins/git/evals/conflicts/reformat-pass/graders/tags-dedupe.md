---
type: regex
pattern: 'new Set\(\s+value'
match: contains
target: { source: file, path: .eval-pushed-tree/src/tags.ts }
---
The branch's dedupe within a single tag value survives.
