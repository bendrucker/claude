---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:errored|errors?\b|session[- ]limit|quota|left (out of )?the pool|dropped from the pool|excluded|lost (3|three) runs|`!`|!\s*(mark|flag)|rate[- ]limit))'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs` and its reason names the cause. Some candidate runs errored on a session limit and left the pool, so the starred row rests on the survivors. The case has to be re-run before its row is read.
