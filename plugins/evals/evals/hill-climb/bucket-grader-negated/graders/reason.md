---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:grader)\b(?![\s\S]*^[\s>*_#-]*bucket[*_\s]*:[*_\s`]*(?:skill|grader|reach|floor)\b))(?=[\s\S]*(?:key order|order of (the )?keys|keys? (is|are) (serialized|written)|anchored|grader (is|was) (wrong|too|failing|broken|at fault)|(regex|pattern) (is |was )?(too|wrong|misses|missed|doesn''t|does not)|negat|ruled out|rules out|meets the intent|intent|(reply|output|behou?r) is (right|correct|fine)|false (negative|fail)))'
flags: im
match: contains
---
The reply's last `Bucket:` line is `grader` and its reason names the cause. The reply meets the intent and the grader failed it, so the fix is the grader.
