---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){1000}'
match: contains
---
The out block holds at least 1000 characters, catching a collapsed draft.
