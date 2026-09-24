---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:restart)'
flags: i
match: contains
---
Recompiling without a restart survives.
