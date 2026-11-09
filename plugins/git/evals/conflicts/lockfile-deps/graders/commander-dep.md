---
type: regex
pattern: '"commander": "~14.0.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/judge/package.json }
---
The judge package keeps the branch's commander dependency.
