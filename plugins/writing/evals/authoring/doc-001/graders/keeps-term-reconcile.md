---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?TERM[\s\S]{0,150}(reconcil\w*|gracefully|writ\w*.{0,30}state|finish(?:es)? or cancel)'
flags: i
match: contains
---
TERM lets Terraform reconcile and write its state before it exits.
