---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n)[\s\S])*?^type:[ \t]*spike[ \t]*$'
flags: m
match: contains
---
The frontmatter types the issue as `spike` (RUBRIC finding 7).
