---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `accept`. Control: one of six rounds ran loaded, and a gain this size at p = 0.001 cannot rest on three runs a side, so the flag doesn't block the accept.
