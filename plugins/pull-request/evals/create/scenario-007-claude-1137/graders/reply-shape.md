---
type: regex
pattern: '^Title: \S[^\n]*\n\n\S'
flags: m
match: contains
---
The reply carries the draft as a `Title:` line, a blank line, then the body.
