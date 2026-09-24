---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:changed since|last plan|shadow-write|stale|corrected)'
flags: i
match: not_contains
---
The revision log is gone.
