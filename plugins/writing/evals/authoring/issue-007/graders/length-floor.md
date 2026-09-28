---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){250}'
match: contains
---
The out block holds at least 250 characters, catching a collapsed draft.
