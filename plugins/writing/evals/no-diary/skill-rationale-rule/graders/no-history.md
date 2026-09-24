---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:march|incident|until|deleted|#88|discussion)'
flags: i
match: not_contains
---
The incident story and the discussion reference are gone.
