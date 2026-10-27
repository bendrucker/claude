---
type: regex
pattern: '^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:grader)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b)'
flags: im
match: contains
---
The reply's last `Bucket:` line is `grader`. The reply meets the intent and the grader failed it, so the fix is the grader.
