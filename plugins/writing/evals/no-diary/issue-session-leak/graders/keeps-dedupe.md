---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:dedup)'
flags: i
match: contains
---
Deduping on `external_id` survives as the fix.
