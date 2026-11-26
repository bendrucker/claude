---
type: regex
target: { source: file, path: docs/deploy.rst }
pattern: 'in order to'
flags: i
match: not_contains
---
The 'in order to' a suggestion flagged is cut.
