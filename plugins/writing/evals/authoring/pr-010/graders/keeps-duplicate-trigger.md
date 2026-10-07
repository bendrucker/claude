---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:(duplicate|double)[\s-]*(fire|trigger)|\btwice\b|once[\s\S]{0,60}again)'
flags: i
match: contains
---
The draft keeps the fact that same-repo PRs double-triggered CI.
