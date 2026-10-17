---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*in[*_ \t]*:[*_]*(?:[^\n]*?,)?[ \t*_]*`?review:code`?[ \t]+\(?high\b'
flags: i
match: contains
---
The plan runs `review:code` at `high` effort.
