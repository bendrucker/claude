---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `accept`. Control: the gain is only 1.1 times the noise floor, but it clears it, at p < 0.1, on quiet rounds, with the guard passing.
