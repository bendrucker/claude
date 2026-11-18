---
type: regex
target: last_message
pattern: '^[*_ ]*Verdict[*_ ]*:[*_ ]*fails\b(?![\s\S]*^[*_ ]*Verdict[*_ ]*:)'
flags: mi
match: contains
---
The reply ends on `Verdict: fails`.
