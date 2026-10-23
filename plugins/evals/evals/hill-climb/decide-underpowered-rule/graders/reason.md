---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:more[- ]runs)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:fewer than (4|four)|less than (4|four)|under (4|four)|too few|(only|just) (3|three) runs|(3|three) runs|†|underpowered|not enough runs|(can''t|cannot|can not|could not) (ever )?star|small (sample|number)|low run count))'
flags: im
match: contains
---
The reply's last `Decision:` line is `more-runs` and its reason names the cause. The only gain sits on cells with fewer than 4 runs a side, which are marked † because no star is possible there.
