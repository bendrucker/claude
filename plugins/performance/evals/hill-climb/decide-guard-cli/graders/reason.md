---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:guard|cmp\b|differ|golden|byte-identical|not identical|behaviou?r (change|differ)|changes? (the )?(output|behaviou?r|results?)))'
flags: im
match: contains
---
The reply's reason names the trap. The gain is real, but the guard check failed before timing.
