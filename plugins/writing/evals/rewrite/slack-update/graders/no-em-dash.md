---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:—)'
flags: i
match: not_contains
---
No em dash enters the rewrite.
