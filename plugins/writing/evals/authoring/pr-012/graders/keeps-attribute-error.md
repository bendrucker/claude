---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:attribute[\s\S]{0,30}error|error[\s\S]{0,30}attribute)'
flags: i
match: contains
---
The draft keeps the runtime failure mode: an unexpected-attribute error.
