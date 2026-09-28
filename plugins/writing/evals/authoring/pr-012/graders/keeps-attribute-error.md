---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?unexpected[\s-]+attribute'
flags: i
match: contains
---
The draft keeps the runtime failure mode: an unexpected-attribute error.
