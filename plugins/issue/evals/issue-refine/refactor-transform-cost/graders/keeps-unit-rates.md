---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?per[- ]GB'
flags: i
match: contains
---
The issue keeps the validation method: compare per-GB rates, since staging wall clock won't predict the largest tenant.
