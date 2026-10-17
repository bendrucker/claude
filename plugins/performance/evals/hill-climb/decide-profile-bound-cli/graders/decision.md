---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `re-run`. The gain is larger than the target entry's whole share of the profile, so it cannot come from that entry alone.
