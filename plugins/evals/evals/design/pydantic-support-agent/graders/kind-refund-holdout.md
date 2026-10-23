---
type: regex
target: last_message
pattern: '^[^|\n]*\|(?=[^\n]*\brefund\b)(?=[^\n]*\bholdout\b)'
flags: m
match: contains
---
A `refund` case is tagged `holdout`.
