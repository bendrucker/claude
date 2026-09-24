---
type: regex
target: { source: file, path: src/load.ts }
pattern: 'const \[, \.\.\.rows\]'
match: not_contains
---
The loader no longer throws away the first row.
