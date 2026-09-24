---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:all tests pass|\b\d+ (tests?|passing)\b)'
flags: i
match: not_contains
---
No test count and no claim that all tests pass.
