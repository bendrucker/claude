---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(%20|\+-\+|\+\s*instead of\s*%|percent[- ]encod)'
flags: i
match: contains
---
The space is wrongly percent-encoded as a literal plus instead of %20.
