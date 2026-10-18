---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#{2,6}[^\n]*related issues'
flags: mi
match: not_contains
---
No standalone Related Issues section. Related issues go in `relations` (RUBRIC finding 2).
