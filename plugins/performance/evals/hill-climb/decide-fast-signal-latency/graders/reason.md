---
type: regex
pattern: '^(?=[\s\S]*(?:full|wall|end.to.end|metric))(?=[\s\S]*(?:flat|not significant|insignificant|(didn''t|did not|doesn''t|does not) (move|improve|change)|no (real |significant |measurable )?(change|gain|improvement|effect)|unchanged|p\s*=\s*0?\.[1-9]|within (the )?noise|\bnull\b|barely|(screen|micro\w*)[^\n]{0,60}(n''t|not|only)))'
flags: i
match: contains
---
The reply's reason names the trap. The fast-signal screen moved, but the full metric is flat. The Rules accept on the full metric only.
