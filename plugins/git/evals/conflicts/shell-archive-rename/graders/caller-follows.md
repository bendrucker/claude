---
type: regex
pattern: '"\$dir/archive" '
match: contains
target: { source: file, path: .eval-pushed-tree/bin/nightly }
---
`bin/nightly`, which main moved, calls the script under its new name.
