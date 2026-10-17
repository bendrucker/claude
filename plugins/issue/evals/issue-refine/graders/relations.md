---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n)[\s\S])*?^relations:(?:(?!\n-{3}\n)[\s\S])*?tracker\.example\.com/issue/TEAM-\d+'
flags: m
match: contains
---
The related issues land under frontmatter `relations` as tracker links (RUBRIC finding 2).
