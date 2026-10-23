---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:holdout[^\n]{0,120}(fell|fall|drop|below|lower|down|regress|worse|declin|overfit|star)|overfit|(fell|fall|drop|below|lower|down|worse|declin)[^\n]{0,80}holdout))'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject` and its reason names the cause. The dev target starred up, but the final holdout score is below the base's, so the gain overfit the dev cases.
