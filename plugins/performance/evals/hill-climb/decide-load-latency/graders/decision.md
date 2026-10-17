---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `re-run`. The gain is significant, but every round ran with the load average above twice the core count.
