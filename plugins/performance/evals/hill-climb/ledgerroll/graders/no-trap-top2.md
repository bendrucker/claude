---
type: regex
pattern: '^\s{0,3}(?:[12][.)]|\|\s*[*_`#]*[12][*_`]*\s*\|)(?![^\n]*(?:Unmarshal|decodeState|map\[string\](any|interface)|decodeRecord|typed struct|sort\.Slice|re-?sort|insertionSort|pdqsort|sort\w*[^\n]{0,80}(each|every|per) (append|insert|txn|transaction)|Sprintf|renderRow|groupKey|strconv\.Append))[^\n]*(gzip|flate|decompress|huffman|crc32)'
flags: im
match: not_contains
weight: 0.5
---
Neither of the first two candidates is gzip decompression, the largest entry but fixed by the feed format and the standard-library scope.
