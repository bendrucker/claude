---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:noise|A/A|floor))'
flags: im
match: contains
---
The reply's reason names the trap. The gain is starred at the report's 3% default, but it is smaller than the A/A noise floor the Rules make the acceptance threshold.
