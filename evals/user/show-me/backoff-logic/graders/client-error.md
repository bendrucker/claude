---
type: regex
pattern: '4xx|starts? ?with\W*4|\b4\d\d\b'
flags: i
match: contains
---
The reply keeps the rule that a 4xx error never retries.
