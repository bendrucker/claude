---
type: regex
pattern: '"semver": "~7.6.0"'
match: contains
target: { source: file, path: .eval-pushed-tree/apps/cli/package.json }
---
The cli app keeps the branch's older semver range.
