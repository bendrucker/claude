---
type: regex
target: last_message
pattern: '^[^|\n]*\|(?=[^\n]*\bdev\b)'
flags: m
match: contains
---
The reply lists a case tagged `dev`.
