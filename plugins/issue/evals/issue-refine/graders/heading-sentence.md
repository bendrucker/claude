---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t][^\n]*[.?!][ \t]*$'
flags: m
match: not_contains
---
No section heading ends as a sentence (RUBRIC finding 1).
