---
type: regex
pattern: '"node_modules/yaml": \{\s*"version": "2\.8\.1"'
flags: s
match: contains
target: { source: file, path: .eval-pushed-tree/packages/app/package-lock.json }
---
main's locked yaml 2.8.1 survives.
