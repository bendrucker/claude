---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs`. The only gain sits on cells with fewer than 4 runs a side, which are marked † because no star is possible there.
