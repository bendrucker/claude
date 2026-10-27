---
type: regex
pattern: '^(?=[^\n]*\bsort\b)(?=[^\n]*compare_rows)'
flags: im
match: contains
---
`sort` is led by `compare_rows`, which formats both keys with `snprintf` on every comparison, about 93% inclusive.
