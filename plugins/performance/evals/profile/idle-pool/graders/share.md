---
type: regex
pattern: '^(?=[^\n]*decode_block)(?=[^\n]*\b(8[5-9]|9[0-7])(\.\d+)?\s?%)'
flags: im
match: contains
---
`decode_block` is about 89 to 94% of the run's CPU on the main thread.
