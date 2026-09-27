---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*in[*_ \t]*:[*_]*(?:[^\n]*?,)?[ \t*_]*`?review:human`?(?:[ \t]+(?:\(?(?:low|medium|high|xhigh)\)?|--[\w-]+))*(?=[ \t*_`]*(?:[,;.(]|\n|$))'
flags: i
match: contains
---
The plan gates in `review:human`.
