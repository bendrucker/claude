---
type: regex
pattern: '^\s{0,3}(\*\*)?1[.)][^\n]*(queue_pop|memmove|pop)'
flags: im
match: contains
---
The first lead is the pop-front shift in `queue_pop`.
