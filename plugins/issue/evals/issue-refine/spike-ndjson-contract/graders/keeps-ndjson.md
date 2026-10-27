---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?ndjson'
flags: i
match: contains
---
The issue keeps the candidate contract: one NDJSON file per metadata table.
