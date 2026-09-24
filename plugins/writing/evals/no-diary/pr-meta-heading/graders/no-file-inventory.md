---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:build\.test\.ts|src/types\.ts)'
flags: i
match: not_contains
---
The file-by-file inventory is gone.
