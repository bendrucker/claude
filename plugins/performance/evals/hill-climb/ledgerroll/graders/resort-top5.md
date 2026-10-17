---
type: regex
pattern: '^\s{0,3}(?:[1-5][.)]|\|\s*[*_`#]*[1-5][*_`]*\s*\|)[^\n]*(sort\.Slice|re-?sort|insertionSort|pdqsort|sort\w*[^\n]{0,80}(each|every|per) (append|insert|txn|transaction))'
flags: im
match: contains
weight: 0.29
---
One of the first five candidates stops re-sorting each group on every append, 10% of the profile.
