---
type: regex
pattern: '"yaml": "\^2.8.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/api/package.json }
---
The api package keeps main's yaml dependency.
