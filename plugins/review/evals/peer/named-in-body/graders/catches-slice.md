---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?\bslice'
match: contains
---
The comments flag that `slice(start, size)` passes the page size as the end index, so every page past the first comes back empty.
