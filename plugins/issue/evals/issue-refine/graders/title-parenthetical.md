---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n)[\s\S])*?^title:[^\n]*\('
flags: m
match: not_contains
---
The title carries no parenthetical (RUBRIC finding 6).
