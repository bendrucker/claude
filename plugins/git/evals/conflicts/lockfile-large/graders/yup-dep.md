---
type: regex
pattern: '"yup": "\^1.4.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/app/package.json }
---
The app keeps the branch's yup dependency.
