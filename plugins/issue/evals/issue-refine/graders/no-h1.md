---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^#[ \t]'
flags: m
match: not_contains
weight: 3
---
The body opens no `#` heading. The title lives in the frontmatter (RUBRIC finding 1).
