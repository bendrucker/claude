---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `accept`. Balance case: the target starred up, the guards stayed flat, the control arm stayed flat, and the holdout holds.
