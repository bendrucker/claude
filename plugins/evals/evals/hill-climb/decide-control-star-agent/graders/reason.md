---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:control|without[- ](arm|column)|the without\b|no[- ]skill arm|both arms|drift|lucky|same (size|star|gain|jump)))'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs` and its reason names the cause. The target star on the with arm is matched by an equal star on the without arm, which the candidate cannot touch, so the gain is drift or a lucky draw.
