---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:block)'
flags: i
match: contains
---
That the comment is not blocking survives.
