---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:\bBen\b|review|asked me)'
flags: i
match: not_contains
---
No reference to the reviewer or the review.
