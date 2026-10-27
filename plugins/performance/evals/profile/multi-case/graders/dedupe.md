---
type: regex
pattern: '^(?=[^\n]*\bdedupe\b)(?=[^\n]*seen_insert)'
flags: im
match: contains
---
`dedupe` is led by the `memmove` inside `seen_insert`'s sorted-array insert, about 97%.
