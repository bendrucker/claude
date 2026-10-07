---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){350}'
match: contains
---
Catches a collapsed draft. The original ran 932 characters; this checks the reply cleared about 40% of that.
