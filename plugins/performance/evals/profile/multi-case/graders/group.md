---
type: regex
pattern: '^(?=[^\n]*\bgroup\b)(?=[^\n]*group_lookup)'
flags: im
match: contains
---
`group` is led by `group_lookup`'s linear scan, about 97%.
