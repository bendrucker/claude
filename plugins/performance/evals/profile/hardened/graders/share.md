---
type: regex
pattern: '^(?=[^\n]*rle_encode)(?=[^\n]*\b7[0-9](\.\d+)?\s?%)'
flags: im
match: contains
---
`rle_encode` is about 75% of the run and `crc_tile` about 25%.
