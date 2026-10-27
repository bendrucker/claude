---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:stall)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:two (null|consecutive|candidates|nulls)|second (null|consecutive|candidate)|(null|flat|nothing moved)[^\n]{0,100}(again|too|also|second|two|in a row|consecutive|back[- ]to[- ]back)|in a row|back[- ]to[- ]back|previous candidate[^\n]{0,80}(null|flat|rejected)|candidate 2[^\n]{0,80}(null|flat|rejected)))'
flags: im
match: contains
---
The reply's last `Decision:` line is `stall` and its reason names the cause. The previous candidate was null and this one is null too, so two nulls in a row call for the Stall review and not another edit.
