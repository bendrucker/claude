---
type: regex
pattern: 'all tests pass|\b\d+ (tests?|passing|specs?)\b'
flags: i
match: not_contains
---
No test counts and no "all tests pass" phrasing.
