---
type: regex
pattern: '"yaml": "\^2.8.0"'
match: contains
target: { source: file, path: packages/judge/package.json }
---
The judge package keeps main's yaml dependency.
