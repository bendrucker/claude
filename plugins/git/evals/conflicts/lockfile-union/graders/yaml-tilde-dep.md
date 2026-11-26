---
type: regex
pattern: '"yaml": "~2.7.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/web/package.json }
---
The web package keeps the branch's older yaml range.
