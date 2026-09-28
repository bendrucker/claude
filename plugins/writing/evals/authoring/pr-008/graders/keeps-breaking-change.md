---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(latest[\s\S]{0,160}(break|1\.18)|(break|1\.18)[\s\S]{0,160}latest)'
flags: i
match: contains
---
Going back to `latest` is named as a break for Go below 1.18.
