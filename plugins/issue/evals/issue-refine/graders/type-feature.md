---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n)[\s\S])*?^type:[ \t]*feature[ \t]*$'
flags: m
match: contains
---
The frontmatter types the issue as `feature`.
