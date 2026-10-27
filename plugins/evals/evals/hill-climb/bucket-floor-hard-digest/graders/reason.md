---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:floor)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b))(?=[\s\S]*(?:(at|on) this tier|(cannot|can''t|could not|couldn''t) (be )?(do|done|answer|know|compute|see|determine)|stronger model|larger model|higher tier|tier above|scaling run|beyond|never provides|not provided|missing|no copy|without (the )?(ticket|tool|information)))'
flags: im
match: contains
---
The reply's last `Bucket:` line is `floor` and its reason names the cause. The model cannot do it at this tier, and the stronger-model check fails too.
