---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:\bshould\b|hopefully|basically)'
flags: i
match: not_contains
---
The hedging is gone.
