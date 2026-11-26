---
type: regex
pattern: 'batched\(rows, per_file\)'
match: contains
target: { source: file, path: .eval-pushed-tree/tally/export.py }
---
The new export module calls the renamed helper.
