---
type: regex
target: last_message
pattern: '^[^|\n]*\|(?=[^\n]*\bholdout\b)'
flags: m
match: contains
---
The reply lists a case tagged `holdout`.
