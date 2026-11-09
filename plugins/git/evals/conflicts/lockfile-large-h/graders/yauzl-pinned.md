---
type: regex
pattern: '"node_modules/yauzl": \{\s*"version": "3\.0\.0"'
flags: s
match: contains
target: { source: file, path: .eval-pushed-tree/packages/worker/package-lock.json }
---
The branch's locked yauzl 3.0.0 is kept instead of floating.
