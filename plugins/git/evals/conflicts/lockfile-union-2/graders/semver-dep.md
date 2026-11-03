---
type: regex
pattern: '"semver": "\^7.7.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/libs/core/package.json }
---
The core library keeps main's semver dependency.
