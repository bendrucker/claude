---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(sibling[\s\S]{0,120}\$PWD|\$PWD[\s\S]{0,120}sibling)'
flags: i
match: contains
---
New panes default to a sibling in the current tab under `$PWD`.
