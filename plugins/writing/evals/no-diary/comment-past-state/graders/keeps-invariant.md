---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:\/\/[^\n]*cacheLock)'
flags: i
match: contains
---
A comment still says callers must hold `cacheLock`.
