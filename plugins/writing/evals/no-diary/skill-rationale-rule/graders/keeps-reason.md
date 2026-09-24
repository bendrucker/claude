---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:expan)'
flags: i
match: contains
---
The clause saying single quotes stop shell expansion survives, since it lets a reader handle unlisted values.
