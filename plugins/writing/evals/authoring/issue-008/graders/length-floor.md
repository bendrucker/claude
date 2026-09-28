---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){350}'
match: contains
---
Requires a body that reaches roughly 40% of the original's character count, so a collapsed draft fails while a terse one still passes.
