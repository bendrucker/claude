---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(platforms[\s\S]{0,150}(no|n.?t)[\s\S]{0,40}platform\s+flag|(no|n.?t)[\s\S]{0,40}platform\s+flag[\s\S]{0,150}platforms)'
flags: i
match: contains
---
No `--platform` flag exists; filter the `platforms` array client-side.
