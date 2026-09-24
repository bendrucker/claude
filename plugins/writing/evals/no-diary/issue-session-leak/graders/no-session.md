---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:claude|pairing|transcript|session)'
flags: i
match: not_contains
---
No reference to the session, the transcript, or pairing.
