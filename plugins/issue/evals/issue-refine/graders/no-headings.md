---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t](?![^\n]*Agent Context)'
flags: m
match: not_contains
---
A trivial issue carries no section heading above Agent Context (RUBRIC finding 5).
