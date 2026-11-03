---
type: regex
pattern: '\bunderAny\b'
match: not_contains
target: { source: file, path: src/report.ts }
---
The new file no longer calls the old name.
