---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[ \t][^\n]*(?:,[ \t]*(?:not|never)\b|n''t\b)'
flags: mi
match: not_contains
weight: 3
---
No section heading uses the "X, not Y" antithesis (RUBRIC finding 1).
