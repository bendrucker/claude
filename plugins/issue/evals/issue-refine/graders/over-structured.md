---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t](?![^\n]*Agent Context)){6}'
flags: m
match: not_contains
---
Fewer than six section headings above Agent Context (RUBRIC finding 5).
