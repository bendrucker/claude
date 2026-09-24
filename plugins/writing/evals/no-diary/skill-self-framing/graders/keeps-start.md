---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:200 ?ms)'
flags: i
match: contains
---
The 200 ms starting delay survives.
