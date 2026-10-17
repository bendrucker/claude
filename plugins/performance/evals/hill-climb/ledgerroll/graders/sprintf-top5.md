---
type: regex
pattern: '^\s{0,3}(?:[1-5][.)]|\|\s*[*_`#]*[1-5][*_`]*\s*\|)[^\n]*(Sprintf|renderRow|groupKey|strconv\.Append)'
flags: im
match: contains
weight: 0.4
---
One of the first five candidates cuts `fmt.Sprintf`, 14% of the profile across `renderRow` and `groupKey`.
