---
type: regex
pattern: '"zod": "\^3\.23\.8"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/worker/package.json }
---
The worker keeps main's zod dependency.
