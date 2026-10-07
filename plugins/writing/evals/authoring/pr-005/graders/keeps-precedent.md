---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?go.{0,10}generate'
flags: i
match: contains
---
The body keeps the analogy: comment-fenced generated output, similar to `//go:generate`.
