---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:\bp\b(?:[- ]?values?)?(\s*[=<\u2248]|\s+(is|of))\s*0?\.\d|signific|beat (the )?noise))'
flags: im
match: contains
---
The reply's reason names the trap. Control: a significant gain past the noise floor, inside the profile bound, on quiet rounds, with the guard passing.
