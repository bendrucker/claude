---
type: regex
pattern: 'human_size "\$archive_kb"'
match: not_contains
target: { source: file, path: .eval-pushed-tree/lib/archive.sh }
---
The new caller does not pass kilobytes unconverted.
