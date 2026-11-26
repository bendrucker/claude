---
type: regex
pattern: '"semver@7.6.3"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
The branch's locked semver 7.6.3 survives.
