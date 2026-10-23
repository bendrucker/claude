---
type: regex
pattern: '^(?=[^\n]*compact_log)(?=[^\n]*(memmove|shift|cop(y|ies)))(?=[^\n]*\b(3[4-9]|4\d|50)(\.\d+)?\s?%)'
flags: im
match: contains
---
`_platform_memmove` is the top self frame, and `compact_log`'s shift reaches it for about 45% of the run. The reply credits `compact_log` with its share through the copy rather than its inclusive total of about 63%.
