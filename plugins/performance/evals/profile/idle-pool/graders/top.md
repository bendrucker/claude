---
type: regex
pattern: '^\s{0,3}(\*\*)?1[.)][^\n]*(decode_block|parallel|pool|worker)'
flags: im
match: contains
---
The first lead is `decode_block` (about 94% of CPU) or spreading that work across the idle pool.
