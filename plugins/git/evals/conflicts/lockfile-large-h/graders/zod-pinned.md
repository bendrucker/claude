---
type: regex
pattern: '"node_modules/zod": \{\s*"version": "3\.23\.8"'
flags: s
match: contains
target: { source: file, path: .eval-pushed-tree/packages/worker/package-lock.json }
---
main's locked zod 3.23.8 is kept instead of floating.
