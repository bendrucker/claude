---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:drop the old column|drop (the )?old)'
flags: i
match: contains
---
Dropping the old column survives.
