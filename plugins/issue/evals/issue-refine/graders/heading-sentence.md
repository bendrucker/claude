---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t][^\n]*[.?!][ \t]*$'
flags: m
match: not_contains
---
No section heading ends as a sentence (RUBRIC finding 1).
