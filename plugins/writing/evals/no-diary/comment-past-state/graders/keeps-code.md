---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:function refresh\(cache: Cache, key: string\))'
flags: i
match: contains
---
The function signature survives the rewrite.
