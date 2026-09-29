---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:\b(?:3|three)\b)'
flags: i
match: contains
---
The cap of 3 retries survives.
