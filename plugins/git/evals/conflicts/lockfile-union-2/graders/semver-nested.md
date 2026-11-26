---
type: regex
pattern: '"@union/core/semver"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
The two semver versions coexist as a nested core entry.
