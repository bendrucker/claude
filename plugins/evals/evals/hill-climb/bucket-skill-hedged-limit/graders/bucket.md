---
type: regex
pattern: '^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b)'
flags: im
match: contains
---
The reply's last `Bucket:` line is `skill`. The skill fired and the reply still breaks a rule it states, so a candidate can target it.
