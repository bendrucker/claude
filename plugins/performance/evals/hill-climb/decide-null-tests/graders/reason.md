---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:not significant|insignificant|p\s*=\s*0?\.[1-9]|no (real |significant |measurable )?(change|gain|improvement|effect)|within (the )?noise|flat|(didn''t|did not|doesn''t|does not) (move|improve)|below))'
flags: im
match: contains
---
The reply's reason names the trap. Control: neither the screen nor the full metric moved past noise.
