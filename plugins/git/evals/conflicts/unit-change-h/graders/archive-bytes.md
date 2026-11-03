---
type: regex
pattern: 'archive_kb\s*\*\s*1024'
match: contains
target: { source: file, path: .eval-pushed-tree/lib/archive.sh }
---
The new caller converts its kilobytes to bytes.
