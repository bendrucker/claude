---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|more[- ]runs|stall|stop|re-?baseline)\b))(?=[\s\S]*(?:effici|latency|faster|seconds|cost|cheaper|duration|speed))(?=[\s\S]*(?:not (a |the |one of the )?(pre-?registered )?targets?|(un|not )registered|unregistered|not pre-?registered|wasn''t (a |the )?target|isn''t (a |the )?target|didn''t (pre-?)?register|target[^\n]{0,40}(flat|unchanged|did not move|didn''t move)|pass (counts|rates?)[^\n]{0,40}(flat|unchanged|same|identical)))'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject` and its reason names the cause. Pass counts are flat and only latency and cost improved, but efficiency was not a pre-registered target, so the improvement is not a result.
