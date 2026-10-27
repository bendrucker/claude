---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:star|signific|p\s*=\s*0?\.0|beat (the )?noise|moved up|rose|\bgain))(?=[\s\S]*(?:guards?[^\n]{0,100}(flat|held|hold|fine|unchanged|no regress|stable|didn''t|did not|not (down|starred)|clean)|(flat|held|hold|unchanged|no regress|stable)[^\n]{0,100}guards?))'
flags: im
match: contains
---
The reply's last `Decision:` line is `accept` and its reason names the cause. Balance case: the target starred up, the guards stayed flat, the control arm stayed flat, and the holdout holds.
