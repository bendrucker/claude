---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*in[*_ \t]*:[*_]*(?:[^\n]*?,)?[ \t*_]*`?simplify`?(?:[ \t]+(?:\(?(?:low|medium|high|xhigh)\)?|--[\w-]+))*(?=[ \t*_`]*(?:[,;.(]|\n|$))'
flags: i
match: not_contains
---
The plan leaves `simplify` off the gated-in list.
