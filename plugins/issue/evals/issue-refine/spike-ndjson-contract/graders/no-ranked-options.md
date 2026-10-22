---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?(?:\boption[ \t]*[1-4]\b|\branked\b|^[ \t]*(?:\d+[.)]|[-*])[ \t][^\n]*\bparquet\b[^\n]*\n[ \t]*(?:\d+[.)]|[-*])[ \t])'
flags: mi
match: not_contains
---
A speculative spike does not carry the session's ranked option list. It states the question and what the answer must show.
