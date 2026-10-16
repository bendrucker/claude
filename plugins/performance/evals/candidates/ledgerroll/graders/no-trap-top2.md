---
type: regex
pattern: '^\s{0,3}[12][.)][^\n]*(gzip|flate|decompress|huffman|crc32)'
flags: im
match: not_contains
---
Neither of the first two candidates is gzip decompression, the largest entry but fixed by the feed format and the standard-library scope.
