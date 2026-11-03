---
type: regex
pattern: '"semver@7.7.4"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
main's locked semver 7.7.4 survives instead of floating.
