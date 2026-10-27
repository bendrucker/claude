---
type: regex
pattern: '^(?=[^\n]*is_reserved)(?=[^\n]*\b(7[4-9]|8[0-4])(\.\d+)?\s?%)'
flags: im
match: contains
---
`hash_key` holds about 95% of self time, and `is_reserved` reaches it for about 78% of the run (four salted hashes per line). The reply puts that share on `is_reserved`.
