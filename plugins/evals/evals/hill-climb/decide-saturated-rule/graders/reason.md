---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:stop)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:ceiling|saturat|1\.00|no (more |remaining )?(room|headroom)|(can''t|cannot|can not|couldn''t|could not) (rise|improve|move|go up)|already (at|pass|perfect|maxed)|nothing (left )?to (gain|climb|improve)|discriminat))'
flags: im
match: contains
---
The reply's last `Decision:` line is `stop` and its reason names the cause. The noise runs put dev at 1.00 on both arms, so there is no room above the noise for the candidate to rise.
