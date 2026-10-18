---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t](?![^\n]*Agent Context)){6}'
flags: m
match: not_contains
---
Fewer than six section headings above Agent Context (RUBRIC finding 5).
