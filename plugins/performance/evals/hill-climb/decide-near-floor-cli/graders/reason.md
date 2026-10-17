---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:\bp\b(\s*[=<\u2248]|\s+(is|of))\s*0?\.\d|signific|beat (the )?noise))(?=[\s\S]*(?:noise|A/A|floor))'
flags: im
match: contains
---
The reply's reason names the trap. Control: the gain is only 1.1 times the noise floor, but it clears it, at p < 0.1, on quiet rounds, with the guard passing.
