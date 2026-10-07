---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?window\.Firebase'
flags: i
match: contains
---
Firebase is expected as the global `window.Firebase`.
