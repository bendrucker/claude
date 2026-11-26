---
type: regex
target: { source: file, path: docs/oncall.rst }
pattern: 'basically'
flags: i
match: not_contains
---
The filler 'basically' the warning flagged is gone.
