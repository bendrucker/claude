---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n)[\s\S])*?^relations:(?:(?!\n---\n)[\s\S])*?tracker\.example\.com/issue/TEAM-\d+'
flags: m
match: contains
---
The related issues land under frontmatter `relations` as tracker links (RUBRIC finding 2).
