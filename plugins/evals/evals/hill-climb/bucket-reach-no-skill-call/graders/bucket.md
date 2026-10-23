---
type: regex
pattern: '^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:reach)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b)'
flags: im
match: contains
---
The reply's last `Bucket:` line is `reach`. The skill never fired, so the reply is the model's default.
