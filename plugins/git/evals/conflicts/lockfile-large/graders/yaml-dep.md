---
type: regex
pattern: '"yaml": "\^2.6.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/app/package.json }
---
The app keeps main's yaml dependency.
