---
type: regex
pattern: 'https\?:'
match: contains
target: { source: file, path: .eval-pushed-tree/src/imports.ts }
---
The branch's URL-specifier filter survives.
