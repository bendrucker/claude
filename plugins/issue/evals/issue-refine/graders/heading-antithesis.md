---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t][^\n]*(?:,[ \t]*(?:not|never)\b|n''t\b)'
flags: mi
match: not_contains
weight: 3
---
No section heading uses the "X, not Y" antithesis (RUBRIC finding 1).
