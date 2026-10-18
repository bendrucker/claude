---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `accept` or `re-run`. The gain is 1.05 times the target entry's whole profile share. The excess is inside the noise floor, so accepting with the excess reported or re-measuring both hold, as long as the reply notices the bound.
