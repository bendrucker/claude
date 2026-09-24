---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:200(?:(?!</rewrite>)[\s\S])*3 ?MB|3 ?MB(?:(?!</rewrite>)[\s\S])*200)'
flags: i
match: contains
---
The bound on cache size (about 200 templates, 3 MB) survives.
