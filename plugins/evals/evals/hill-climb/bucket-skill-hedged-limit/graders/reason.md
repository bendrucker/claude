---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b))(?=[\s\S]*(?:broke|breaks|broken|ignor|violat|disobey|didn''t follow|did not follow|not follow|hedg|contradict|against the (rule|skill)|skill (caused|failed)))'
flags: im
match: contains
---
The reply's last `Bucket:` line is `skill` and its reason names the cause. The skill fired and the reply still breaks a rule it states, so a candidate can target it.
