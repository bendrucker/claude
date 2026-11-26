---
type: regex
pattern: '\.replace\(/\^-\+\|-\+\$/g, ""\)'
match: contains
target: { source: file, path: .eval-pushed-tree/src/slug.ts }
---
The picked commit's hyphen trim survives.
