---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?grace period'
flags: i
match: contains
---
Recommend TERM first, and only KILL after a grace period if hung.
