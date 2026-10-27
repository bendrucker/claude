---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:reach)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b))(?=[\s\S]*(?:never (fired|fire|loaded|invoked|called|triggered)|(did not|didn''t|does not|doesn''t|wasn''t|was not) (fire|load|invoke|call|trigger)|no `?skill`? call|skill (never|didn''t|did not|wasn''t)|model(''s)? default|description|trigger|0/6))'
flags: im
match: contains
---
The reply's last `Bucket:` line is `reach` and its reason names the cause. The skill never fired, so the reply is the model's default.
