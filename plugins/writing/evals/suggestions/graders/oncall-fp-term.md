---
type: regex
target: { source: file, path: docs/oncall.rst }
pattern: 'flapping'
match: contains
---
The alerting term 'flapping', which a suggestion flagged, stays.
