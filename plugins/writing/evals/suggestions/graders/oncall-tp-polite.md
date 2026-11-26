---
type: regex
target: { source: file, path: docs/oncall.rst }
pattern: 'make sure to'
flags: i
match: not_contains
---
The padded instruction a suggestion flagged is cut.
