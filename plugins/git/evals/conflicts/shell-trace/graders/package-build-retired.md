---
type: regex
pattern: 'build-default-packages'
match: not_contains
target: { source: file, path: .eval-pushed-tree/bin/dotf }
---
The retired package build step stays out of `bin/dotf`.
