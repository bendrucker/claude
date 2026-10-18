---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:exceed|larger than|more than|bigger than|greater than|beyond|bound|unexplained|(can''t|cannot|doesn''t|does not) (be )?(explain|account)|impossible|implausibl|only accounts|at most|can''t come from|cannot come from))(?=[\s\S]*(?:profile|share|cum|critical path))'
flags: im
match: contains
---
The reply's reason names the trap. The gain is larger than the target entry's whole share of the profile, so it cannot come from that entry alone.
