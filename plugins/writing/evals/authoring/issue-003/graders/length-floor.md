---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){550}'
match: contains
---
The out block holds at least 550 characters, catching a collapsed draft.
