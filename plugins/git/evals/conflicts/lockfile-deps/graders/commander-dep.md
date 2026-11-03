---
type: regex
pattern: '"commander": "~15.0.0"'
match: contains
target: { source: file, path: packages/judge/package.json }
---
The judge package keeps the branch's commander dependency.
