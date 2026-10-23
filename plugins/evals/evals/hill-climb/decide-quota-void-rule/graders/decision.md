---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs`. Some candidate runs errored on a session limit and left the pool, so the starred row rests on the survivors. The case has to be re-run before its row is read.
