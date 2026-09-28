---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(duplicate|double)[\s-]*(fire|trigger)'
flags: i
match: contains
---
The draft keeps the fact that same-repo PRs double-triggered CI.
