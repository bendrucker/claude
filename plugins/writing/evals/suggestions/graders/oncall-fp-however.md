---
type: regex
target: { source: file, path: docs/oncall.rst }
pattern: 'However, a page'
match: contains
---
The 'However' a suggestion flagged stays as written.
