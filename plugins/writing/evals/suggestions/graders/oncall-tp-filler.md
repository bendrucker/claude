---
type: regex
target: { source: file, path: docs/oncall.rst }
pattern: 'In terms of'
flags: i
match: not_contains
---
The 'In terms of' opener a suggestion flagged is cut.
