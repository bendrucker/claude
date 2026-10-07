---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?((?:replac|creat)\w*[\s\S]{0,60}conflict|conflict[\s\S]{0,60}(?:replac|creat)\w*)'
flags: i
match: contains
---
The forced replace fails with a conflict on refresh.
