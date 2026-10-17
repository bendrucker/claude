---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[^\n]*\boptions?\b'
flags: mi
match: not_contains
---
No option-menu heading. State the chosen approach or the goal (RUBRIC finding 5).
