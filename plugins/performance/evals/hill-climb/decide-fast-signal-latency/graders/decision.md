---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject`. The fast-signal screen moved, but the full metric is flat. The Rules accept on the full metric only.
