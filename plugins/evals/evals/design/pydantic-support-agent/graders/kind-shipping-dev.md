---
type: regex
target: last_message
pattern: '^[^|\n]*\|(?=[^\n]*\bshipping\b)(?=[^\n]*\bdev\b)'
flags: m
match: contains
---
A `shipping` case is tagged `dev`.
