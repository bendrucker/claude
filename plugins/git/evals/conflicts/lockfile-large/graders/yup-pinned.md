---
type: regex
pattern: '"node_modules/yup": \{\s*"version": "1\.7\.0"'
flags: s
match: contains
target: { source: file, path: .eval-pushed-tree/packages/app/package-lock.json }
---
The branch's locked yup 1.7.0 survives instead of floating.
