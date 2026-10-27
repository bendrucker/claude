---
type: regex
pattern: '^(?=[^\n]*\bfilter\b)(?=[^\n]*(parse_amount|strtod))'
flags: im
match: contains
---
`filter` is led by `parse_amount`'s repeated `strtod`, about 85% inclusive.
