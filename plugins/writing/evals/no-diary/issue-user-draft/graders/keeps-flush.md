---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:flush)'
flags: i
match: contains
---
The missing flush survives.
