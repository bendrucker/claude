---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:function read\(input: string\))'
flags: i
match: contains
---
The function signature survives the rewrite.
