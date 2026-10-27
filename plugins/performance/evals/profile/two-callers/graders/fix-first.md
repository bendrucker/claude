---
type: regex
pattern: '^\s{0,3}(\*\*)?1[.)][^\n]*is_reserved'
flags: im
match: contains
---
The first lead is `is_reserved`, the caller that hashes every key once per reserved word, rather than `hash_key` alone.
