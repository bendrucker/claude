---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?TERM[\s\S]{0,80}(reconcil\w*|gracefully)'
flags: i
match: contains
---
TERM lets Terraform reconcile and write its state before it exits.
