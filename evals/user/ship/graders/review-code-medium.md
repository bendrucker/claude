---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*in[*_ \t]*:[*_]*(?:[^\n]*?,)?[ \t*_]*`?(?:code-review|review:code)`?[ \t]+\(?medium\b'
flags: i
match: contains
---
The plan runs `code-review` at `medium` effort.
