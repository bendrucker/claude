---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs`. The target star on the with arm is matched by an equal star on the without arm, which the candidate cannot touch, so the gain is drift or a lucky draw.
