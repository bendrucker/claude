---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:originally|fixed interval|reason this rule|well-known)'
flags: i
match: not_contains
---
The rejected alternative and the argument for the rule are gone.
