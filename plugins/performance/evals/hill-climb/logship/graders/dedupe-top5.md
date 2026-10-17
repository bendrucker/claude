---
type: regex
pattern: '^\s{0,3}(?:[1-5][.)]|\|\s*[*_`#]*[1-5][*_`]*\s*\|)[^\n]*(dedup|O\(n(²|\^2)\)|quadratic)'
flags: im
match: contains
weight: 0.65
---
One of the first five candidates targets the quadratic `dedupe`, 43.9% of the profile.
