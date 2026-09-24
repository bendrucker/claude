---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:null check)'
flags: i
match: contains
---
The redundant null check survives.
