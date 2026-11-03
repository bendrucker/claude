---
type: regex
pattern: '\bsplit_chunks\b'
match: not_contains
target: { source: file, path: .eval-pushed-tree/tally/export.py }
---
The new export module no longer uses the old name.
