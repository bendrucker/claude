---
type: regex
pattern: 'batched\(\[row for row in rows if row\], BATCH\)'
match: contains
target: { source: file, path: .eval-pushed-tree/tally/ingest.py }
---
The branch's empty-row filter survives under the new name.
