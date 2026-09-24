---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:obvious to a reviewer|this section)'
flags: i
match: not_contains
---
The heading echoing the instruction and the section intro are gone.
