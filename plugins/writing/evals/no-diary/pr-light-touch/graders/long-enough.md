---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:(?:(?!</rewrite>)[\s\S]){380})'
flags: i
match: contains
---
The rewrite keeps at least 380 characters of a roughly 560-character body, since little of it is diary.
