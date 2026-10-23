---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?baseline)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `re-baseline`. The baseline and candidate columns ran on a different claude version or model, so the comparison measures the change in build and not the candidate.
