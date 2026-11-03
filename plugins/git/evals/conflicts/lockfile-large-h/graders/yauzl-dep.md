---
type: regex
pattern: '"yauzl": "\^3\.0\.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/packages/worker/package.json }
---
The worker keeps the branch's yauzl dependency.
