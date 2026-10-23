---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:guard[^\n]{0,100}(star|regress|drop|fell|down|worse|fail|collaps|lost)|(regress|drop|fell|down|worse|collaps|lost)[^\n]{0,100}guard|no-false-alarm[^\n]{0,100}(star|regress|drop|fell|down|worse|fail|collaps|lost)|no-false-alarm[^\n]{0,40}(1/6|1 of 6|0\.17)))'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject` and its reason names the cause. The target starred up, but a pre-registered guard starred down, which blocks the change, and the traces tie the drop to the candidate.
