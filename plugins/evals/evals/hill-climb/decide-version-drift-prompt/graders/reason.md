---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?baseline)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:claude --version|\bversion\b|\bmodel\b))(?=[\s\S]*(?:differ|chang|drift|mismatch|not comparable|different|mixed|bumped|upgrade|updated|2\.1\.236|opus-5-1))'
flags: im
match: contains
---
The reply's last `Decision:` line is `re-baseline` and its reason names the cause. The baseline and candidate columns ran on a different claude version or model, so the comparison measures the change in build and not the candidate.
