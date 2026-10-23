---
type: regex
pattern: '^(?=[^\n]*tone_map)(?=[^\n]*\b(7[5-9]|8\d)(\.\d+)?\s?%)'
flags: im
match: contains
---
`tone_map` is about 83% of the optimized run and `mix_rows` about 16%.
