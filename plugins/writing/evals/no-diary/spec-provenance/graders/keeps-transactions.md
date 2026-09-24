---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:transaction)'
flags: i
match: contains
---
Grants sharing transactions with the rows they protect survives.
