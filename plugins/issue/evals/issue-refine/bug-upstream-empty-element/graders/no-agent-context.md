---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?^#{1,6}[^\n]*Agent Context'
flags: m
match: not_contains
---
An issue filed in a repository the team doesn't maintain carries no Agent Context section. The maintainers know their code.
