---
type: regex
pattern: 'slice\(0, max\)[\s\S]*\^-\+\|-\+\$'
match: contains
target: { source: file, path: .eval-pushed-tree/src/slug.ts }
---
The hyphen trim runs after the length cap. A cut slug never ends in a hyphen.
