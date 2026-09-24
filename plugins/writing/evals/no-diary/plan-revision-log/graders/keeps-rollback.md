---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:rollback)'
flags: i
match: contains
---
The rollback section survives.
