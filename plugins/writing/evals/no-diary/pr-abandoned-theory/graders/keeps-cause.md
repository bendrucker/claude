---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:drain)'
flags: i
match: contains
---
The real cause, awaiting `spawn` before the stream drained, survives.
