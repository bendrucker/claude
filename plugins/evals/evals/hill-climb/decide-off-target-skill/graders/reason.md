---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:not (a |one of the |the )?(pre-?registered )?targets?|outside (of )?(the )?(pre-?registered )?(targets|guards|target)|(un|not )registered|unregistered|not pre-?registered|off-target|non-target|not a result|a lead|wasn''t (a |the )?target|isn''t (a |the )?target|target[^\n]{0,40}(flat|unchanged|did not move|didn''t move|did not rise|didn''t rise)))'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject` and its reason names the cause. The only star is on a grader outside the pre-registered targets and guards, which is a lead for error analysis and not a result. The registered target did not move.
