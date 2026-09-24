---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:func indexName)'
flags: i
match: contains
---
The function signature survives.
