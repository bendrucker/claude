---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t]+summary[ \t]*$'
flags: mi
match: not_contains
---
No Summary heading. The body opens with the summary prose (RUBRIC finding 5).
