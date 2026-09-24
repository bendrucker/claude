---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:report)'
flags: i
match: contains
---
Reporting the error after the last failure survives.
