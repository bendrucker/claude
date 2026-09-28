---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){200}'
match: contains
---
The out block holds at least 200 characters, catching a collapsed draft.
