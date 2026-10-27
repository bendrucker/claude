---
type: regex
pattern: '^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:floor)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b)'
flags: im
match: contains
---
The reply's last `Bucket:` line is `floor`. The model cannot do it at this tier, and the stronger-model check fails too.
