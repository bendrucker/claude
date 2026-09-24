---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:march|deadlock|we added|old approach|kept getting missed|worst hit)'
flags: i
match: not_contains
---
No incident story and no description of the old approach.
