---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n)[\s\S])*?^title:[^\n]*\('
flags: m
match: not_contains
---
The title carries no parenthetical (RUBRIC finding 6).
